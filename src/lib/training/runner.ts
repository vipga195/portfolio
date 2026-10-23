// Runs one claimed training job in a worker thread, keeps the run row alive, and always leaves it in a final state.
import { Worker } from "node:worker_threads";

import { parseEpisodes } from "../ai/algorithm.ts";
import { getAlgorithm, getGame } from "../registry.ts";
import { HEARTBEAT_MS } from "./config.ts";
import type { JobStore, TrainingRun } from "./jobs.ts";
import type { WorkerInput, WorkerMessage } from "./train-worker.ts";

export type RunOptions = {
  maxRuntimeMs?: number;
  workerMemoryMb?: number;
  heartbeatMs?: number;
  cancelPollMs?: number;
  // Games per variant in the final evaluation (default: the shared benchmark size)
  evalGames?: number;
  // Aborting stops the worker and marks the run failed ("shutdown")
  signal?: AbortSignal;
  // Test hooks: another worker entry, and a look at the spawned worker
  workerUrl?: URL;
  onWorker?: (worker: Worker) => void;
};

export const DEFAULT_MAX_RUNTIME_MS = 10 * 60 * 1000;
export const DEFAULT_WORKER_MB = 512;
// The brains.data CHECK allows 8 MiB of jsonb text, which is longer than JSON.stringify output (jsonb adds a space after
// every "," and ":"). 6 MiB of JSON.stringify leaves room for that worst case; the DB check stays the final authority.
export const MAX_BRAIN_BYTES = 6 * 1024 * 1024;

export function brainFitsLimit(brain: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(brain)) <= MAX_BRAIN_BYTES;
}

const CHECK_VIOLATION = "23514";

function isCheckViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === CHECK_VIOLATION;
}
// Trusted (CLI / admin) runs may exceed the public per-algorithm cap, but never the table CHECK
const TRUSTED_MAX_EPISODES = 1_000_000;

function isProgress(message: WorkerMessage): message is Extract<WorkerMessage, { type: "progress" }> {
  return message.type === "progress";
}

// What goes into training_runs.error: first line only, file paths hidden, bounded. No stack traces or server paths.
export function shortMessage(text: string): string {
  return text.split("\n")[0].replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@-]+)+/g, "<path>").slice(0, 200);
}

function validate(run: TrainingRun): string | null {
  const game = getGame(run.game);
  if (!game) return "unknown game";
  const algorithm = getAlgorithm(run.algorithm);
  if (!algorithm) return "unknown algorithm";
  if (algorithm.parseParams(run.params) === null) return "invalid params";
  if (run.trusted) {
    if (!Number.isInteger(run.episodesTotal) || run.episodesTotal < 1 || run.episodesTotal > TRUSTED_MAX_EPISODES) return "invalid episodes";
  } else if (parseEpisodes(algorithm, run.episodesTotal) === null) {
    return `episodes must be 1..${algorithm.PUBLIC_MAX_EPISODES} for ${algorithm.id}`;
  }
  return null;
}

export async function runJob(store: JobStore, run: TrainingRun, options: RunOptions = {}): Promise<void> {
  const problem = validate(run);
  if (problem) {
    await store.fail(run.id, problem);
    return;
  }

  if (options.signal?.aborted) {
    await store.fail(run.id, "shutdown");
    return;
  }

  const maxRuntimeMs = options.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  const memoryMb = options.workerMemoryMb ?? DEFAULT_WORKER_MB;
  const input: WorkerInput = { game: run.game, algorithm: run.algorithm, params: run.params, episodes: run.episodesTotal, evalGames: options.evalGames };
  const worker = new Worker(options.workerUrl ?? new URL("./train-worker.ts", import.meta.url), {
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: memoryMb },
  });

  options.onWorker?.(worker);
  await new Promise<void>((resolve) => {
    // All state is declared before anything that can call settle()
    let settled = false;
    let lastEpisode = 0;
    // Store writes from progress messages run in order, and "done" waits for them
    let pending: Promise<void> = Promise.resolve();
    const timers: { heartbeat?: ReturnType<typeof setInterval>; cancelPoll?: ReturnType<typeof setInterval>; timeLimit?: ReturnType<typeof setTimeout> } = {};
    const swallow = (): void => undefined;

    const onAbort = (): void => void settle(() => store.fail(run.id, "shutdown"));

    // Runs `finalize` once, after the timers are stopped and the worker is gone
    async function settle(finalize: () => Promise<void>): Promise<void> {
      if (settled) return;
      settled = true;
      clearInterval(timers.heartbeat);
      clearInterval(timers.cancelPoll);
      clearTimeout(timers.timeLimit);
      options.signal?.removeEventListener("abort", onAbort);
      await worker.terminate().catch(swallow);
      try {
        await pending;
        await finalize();
      } catch {
        // Last resort so the run never stays "running"; failStale covers a store that is down
        await store.fail(run.id, "internal error").catch(swallow);
      }
      resolve();
    }

    worker.on("message", (message: WorkerMessage) => {
      if (settled) return;
      if (isProgress(message)) {
        lastEpisode = message.episode;
        const metric = { episode: message.episode, avg: message.avg, best: message.best, loss: message.loss ?? null };
        pending = pending.then(() => store.addMetric(run.id, metric)).then(() => store.heartbeat(run.id, message.episode)).catch(swallow);
      } else if (message.type === "done") {
        void settle(async () => {
          if (!brainFitsLimit(message.brain)) {
            await store.fail(run.id, "brain too large");
            return;
          }
          try {
            await store.complete(run.id, { brain: message.brain, eval: message.eval, episodes: run.episodesTotal });
          } catch (error) {
            // The DB check is stricter than our estimate in rare cases
            await store.fail(run.id, isCheckViolation(error) ? "brain too large" : "internal error");
          }
        });
      } else {
        void settle(() => store.fail(run.id, shortMessage(message.message)));
      }
    });
    worker.on("error", (error: Error & { code?: string }) => {
      const text = error.code === "ERR_WORKER_OUT_OF_MEMORY" ? `out of memory (limit ${memoryMb} MB)` : shortMessage(error.message);
      void settle(() => store.fail(run.id, text));
    });
    worker.on("exit", (code) => {
      void settle(() => store.fail(run.id, code === 0 ? "worker exited unexpectedly" : `worker exited with code ${code}`));
    });

    timers.heartbeat = setInterval(() => void store.heartbeat(run.id, lastEpisode).catch(swallow), options.heartbeatMs ?? HEARTBEAT_MS);
    timers.cancelPoll = setInterval(() => {
      store.isCancelRequested(run.id).then((cancel) => {
        if (cancel) void settle(() => store.finishCancelled(run.id));
      }, swallow);
    }, options.cancelPollMs ?? 2000);
    timers.timeLimit = setTimeout(() => void settle(() => store.fail(run.id, "time limit exceeded")), maxRuntimeMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    // The signal may have fired while the worker was being created
    if (options.signal?.aborted) onAbort();
  });
}
