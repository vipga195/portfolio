// Worker-thread entry: trains one run and reports back by messages. Runs synchronously for a long time,
// which is why it lives in its own thread. Everything in workerData is re-validated here.
import { parentPort, workerData } from "node:worker_threads";

import { BENCHMARK_GAMES, BENCHMARK_SEED, benchmarkPolicy } from "../ai/benchmark.ts";
import { getAlgorithm, getGame } from "../registry.ts";

export type WorkerInput = { game: string; algorithm: string; params: unknown; episodes: number; evalGames?: number };

export type WorkerMessage =
  | { type: "progress"; episode: number; avg: number; best: number; loss?: number }
  | { type: "done"; brain: unknown; eval: unknown }
  | { type: "error"; message: string };

function run(input: WorkerInput, post: (message: WorkerMessage) => void): void {
  const game = getGame(input.game);
  const algorithm = getAlgorithm(input.algorithm);
  if (!game || !algorithm) throw new Error("unknown game or algorithm");
  const params = algorithm.parseParams(input.params);
  if (params === null) throw new Error("invalid params");

  const model = algorithm.train(game, params, {
    episodes: input.episodes,
    rng: Math.random,
    reportEvery: Math.max(1, Math.ceil(input.episodes / 50)),
    onProgress: ({ episode, avg, best, loss }) => post(loss === undefined ? { type: "progress", episode, avg, best } : { type: "progress", episode, avg, best, loss }),
  });
  const brain = algorithm.serialize(model, game, input.episodes);
  const result = benchmarkPolicy(game, (rng) => algorithm.createPolicy(model, game, rng), { games: input.evalGames ?? BENCHMARK_GAMES });
  post({ type: "done", brain, eval: { seed: BENCHMARK_SEED, ...result } });
}

if (parentPort) {
  const port = parentPort;
  const input = workerData as WorkerInput;   // set by runner.ts, which validated it; run() re-checks game, algorithm and params
  try {
    run(input, (message) => port.postMessage(message));
  } catch (error) {
    port.postMessage({ type: "error", message: error instanceof Error ? error.message : "training failed" } satisfies WorkerMessage);
  }
}
