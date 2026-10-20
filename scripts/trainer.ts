// Training daemon: claims queued runs from Postgres one at a time and trains them in a worker thread.
// Usage: DATABASE_URL=... (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) node scripts/trainer.ts [--once]      (--once: drain the queue, then exit)
// Env: TRAINER_MAX_RUNTIME_MS (600000), TRAINER_POLL_MS (2000), TRAINER_STALE_MS (60000), TRAINER_WORKER_MB (512)
import { hostname } from "node:os";

import { Pool } from "pg";
import type { PoolConfig } from "pg";

import { readTrainerConfig } from "../src/lib/training/config.ts";
import type { TrainerConfig } from "../src/lib/training/config.ts";
import { poolConfigFromEnv } from "../src/lib/training/connection.ts";
import { PgJobStore } from "../src/lib/training/jobs.ts";
import { runJob } from "../src/lib/training/runner.ts";

const SHUTDOWN_GRACE_MS = 30_000;

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  let config: PoolConfig;
  let limits: TrainerConfig;
  try {
    config = poolConfigFromEnv();
    limits = readTrainerConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "invalid configuration");
    process.exit(1);
  }
  const workerId = `${hostname()}-${process.pid}`;

  const pool = new Pool({ ...config, max: 3 });
  const store = new PgJobStore(pool);
  const abort = new AbortController();
  let stopping = false;
  let wake: () => void = () => undefined;

  const onSignal = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: no new runs; the current run gets ${SHUTDOWN_GRACE_MS / 1000}s to finish`);
    setTimeout(() => abort.abort(), SHUTDOWN_GRACE_MS).unref();
    wake();
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  console.log(`trainer ${workerId} started${once ? " (--once)" : ""}`);
  while (!stopping) {
    try {
      const lost = await store.failStale(limits.staleMs);
      if (lost > 0) console.log(`marked ${lost} stale run(s) failed`);
      const run = await store.claimNext(workerId, { maxRunning: 1 });
      if (run) {
        if (stopping) {
          // Shutdown began between claim and start: hand the run back instead of failing it
          await store.requeue(run.id);
          console.log(`run ${run.id}: requeued (shutdown)`);
          break;
        }
        console.log(`run ${run.id}: ${run.algorithm} on ${run.game}, ${run.episodesTotal} episodes`);
        await runJob(store, run, { maxRuntimeMs: limits.maxRuntimeMs, workerMemoryMb: limits.workerMb, signal: abort.signal });
        const after = await store.getRun(run.id);
        console.log(`run ${run.id}: ${after?.status ?? "unknown"}${after?.error ? ` (${after.error})` : ""}`);
        continue;
      }
      if (once) break;
    } catch (error) {
      console.error(`loop error: ${error instanceof Error ? error.message : String(error)}`);
      if (once) process.exitCode = 1;
      if (once) break;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, limits.pollMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
  await pool.end();
  console.log("trainer stopped");
}

main().catch((error: unknown) => {
  console.error(`trainer failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
