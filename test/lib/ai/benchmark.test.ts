import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BENCHMARK_GAMES, BENCHMARK_SEED, benchmarkPolicy } from "../../../src/lib/ai/benchmark.ts";
import type { Game } from "../../../src/lib/ai/game.ts";
import { snakeGame } from "../../../src/lib/game/snake-game.ts";
import type { SnakeEnvState } from "../../../src/lib/game/snake-env.ts";

const small = { games: 8 };
// Random policy driven by the rng the benchmark hands over
const randomPolicy = (rng: () => number) => () => Math.floor(rng() * 3);

describe("benchmarkPolicy", () => {
  it("exposes the shared defaults", () => {
    assert.equal(BENCHMARK_GAMES, 100);
    assert.equal(typeof BENCHMARK_SEED, "number");
  });

  it("is deterministic for the same seed", () => {
    const a = benchmarkPolicy(snakeGame, randomPolicy, { ...small, seed: 1 });
    const b = benchmarkPolicy(snakeGame, randomPolicy, { ...small, seed: 1 });
    assert.deepEqual(a, b);
    assert.equal(a.variants.length, snakeGame.evalVariants.length);
    assert.equal(a.variants[0].games, 8);
  });

  it("differs for another seed", () => {
    const a = benchmarkPolicy(snakeGame, randomPolicy, { ...small, seed: 1 });
    const b = benchmarkPolicy(snakeGame, randomPolicy, { ...small, seed: 2 });
    assert.notDeepEqual(a, b);
  });

  it("overall is the mean of the per-variant averages", () => {
    const r = benchmarkPolicy(snakeGame, randomPolicy, small);
    const mean = r.variants.reduce((s, v) => s + v.avg, 0) / r.variants.length;
    assert.ok(Math.abs(r.overall - mean) < 1e-12);
  });

  it("shows different policies the same game sequence", () => {
    const record = (log: SnakeEnvState[]): Game<SnakeEnvState> => ({
      ...snakeGame,
      reset: (rng, variant) => {
        const state = snakeGame.reset(rng, variant);
        log.push(state);
        return state;
      },
    });
    const logA: SnakeEnvState[] = [];
    const logB: SnakeEnvState[] = [];
    benchmarkPolicy(record(logA), randomPolicy, small);
    benchmarkPolicy(record(logB), () => () => 0, small);
    assert.equal(logA.length, 8 * snakeGame.evalVariants.length);
    assert.deepEqual(logA, logB);
  });

  it("throws when a game never ends", () => {
    const endless: Game<number> = {
      id: "endless",
      actionCount: 1,
      reset: () => 0,
      step: (s) => ({ next: s + 1, reward: 0, done: false }),
      score: (s) => s,
      evalVariants: [{ label: "x", variant: 0 }],
    };
    assert.throws(() => benchmarkPolicy(endless, () => () => 0, { games: 1 }), /did not end/);
  });
});
