import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseEpisodes } from "../../../src/lib/ai/algorithm.ts";
import { dqnAlgorithm } from "../../../src/lib/ai/algorithms/dqn.ts";
import { qLearningAlgorithm } from "../../../src/lib/ai/algorithms/q-learning.ts";
import { benchmarkPolicy } from "../../../src/lib/ai/benchmark.ts";
import type { Game } from "../../../src/lib/ai/game.ts";
import type { Mlp } from "../../../src/lib/ai/nn.ts";
import type { QTable } from "../../../src/lib/ai/qlearning.ts";
import { snakeGame } from "../../../src/lib/game/snake-game.ts";
import { seededRng } from "../../../src/lib/rng.ts";
import { ALGORITHMS } from "../../../src/lib/registry.ts";

const q = qLearningAlgorithm;
const dqn = dqnAlgorithm;
const SMALL_DQN = { hidden: [16], replaySize: 2000, warmupSteps: 100, batchSize: 16, targetSyncEvery: 100 };

describe("brain compatibility", () => {
  it("q-learning serialize matches the metadata of public/brains/snake.json", () => {
    const params = q.parseParams({});
    assert.ok(params);
    const model = q.train(snakeGame, params, { episodes: 2, rng: seededRng(1) });
    const fresh = q.serialize(model, snakeGame, 2) as Record<string, unknown>;   // brain JSON is an object by contract
    const saved = JSON.parse(readFileSync("public/brains/snake.json", "utf8")) as Record<string, unknown>;   // trusted repo file
    assert.ok(q.parse(fresh, snakeGame));
    for (const key of ["game", "version", "featuresVersion", "stateCount", "actionCount"]) {
      assert.equal(fresh[key], saved[key], key);
    }
    assert.ok(q.parse(saved, snakeGame));
  });

  it("rejects size mismatches", () => {
    const qp = q.parseParams({});
    assert.ok(qp);
    const qb = q.serialize(q.train(snakeGame, qp, { episodes: 2, rng: seededRng(1) }), snakeGame, 2) as Record<string, unknown>;   // brain JSON is an object by contract
    assert.equal(q.parse({ ...qb, stateCount: 1024 }, snakeGame), null);
    assert.equal(q.parse({ ...qb, actionCount: 4 }, snakeGame), null);
    assert.equal(q.parse({ ...qb, q: (qb.q as number[]).slice(1) }, snakeGame), null);   // q is an array by contract

    const dp = dqn.parseParams(SMALL_DQN);
    assert.ok(dp);
    const db = dqn.serialize(dqn.train(snakeGame, dp, { episodes: 2, rng: seededRng(1) }), snakeGame, 2) as Record<string, unknown>;   // brain JSON is an object by contract
    assert.ok(dqn.parse(db, snakeGame));
    assert.equal(dqn.parse({ ...db, observationSize: 10 }, snakeGame), null);
    assert.equal(dqn.parse({ ...db, actionCount: 4 }, snakeGame), null);
    const net = db.net as { sizes: number[] };   // serialized net has sizes by contract
    assert.equal(dqn.parse({ ...db, net: { ...net, sizes: [net.sizes[0] + 1, ...net.sizes.slice(1)] } }, snakeGame), null);
  });
});

describe("params caps", () => {
  it("dqn rejects out-of-range values and accepts defaults", () => {
    assert.ok(dqn.parseParams(dqn.defaultParams));
    for (const bad of [{ replaySize: 1_000_000 }, { replaySize: 999 }, { batchSize: 4096 }, { batchSize: 7 }, { learnEvery: 0 }, { learnEvery: 33 },
      { batchSize: 256, learnEvery: 2 }, { warmupSteps: 1_000_000 }, { targetSyncEvery: 0 }, { targetSyncEvery: 1e9 }]) {
      assert.equal(dqn.parseParams(bad), null, JSON.stringify(bad));
    }
  });
});

describe("parseEpisodes", () => {
  it("accepts integers up to the public cap only", () => {
    assert.equal(parseEpisodes(q, 20_000), 20_000);
    assert.equal(parseEpisodes(q, 20_001), null);
    assert.equal(parseEpisodes(dqn, 5_000), 5_000);
    assert.equal(parseEpisodes(dqn, 5_001), null);
    assert.equal(parseEpisodes(dqn, 1), 1);
    for (const bad of [0, -1, 1.5, NaN, Infinity, "10", null, undefined, {}]) assert.equal(parseEpisodes(q, bad), null);
  });
});

describe("train()", () => {
  for (const algorithm of Object.values(ALGORITHMS)) {
    it(`${algorithm.id} throws on invalid episodes`, () => {
      const params = algorithm.parseParams({});
      assert.ok(params);
      for (const episodes of [0, 1.5, NaN]) {
        assert.throws(() => algorithm.train(snakeGame, params, { episodes, rng: seededRng(1) }), /positive integer/);
      }
    });
  }

  it("q-learning leaves `initial` untouched", () => {
    const params = q.parseParams({});
    assert.ok(params);
    const initial = q.train(snakeGame, params, { episodes: 5, rng: seededRng(1) });
    const snapshot = Float64Array.from(initial.values);
    const out: QTable = q.train(snakeGame, params, { episodes: 20, rng: seededRng(2), initial });
    assert.deepEqual(initial.values, snapshot);
    assert.notEqual(out, initial);
    assert.notDeepEqual(out.values, snapshot);
  });

  it("dqn leaves `initial` untouched", () => {
    const params = dqn.parseParams(SMALL_DQN);
    assert.ok(params);
    const initial = dqn.train(snakeGame, params, { episodes: 5, rng: seededRng(1) });
    const snapshot = JSON.stringify(dqn.serialize(initial, snakeGame, 5));
    const out: Mlp = dqn.train(snakeGame, params, { episodes: 20, rng: seededRng(2), initial });
    assert.equal(JSON.stringify(dqn.serialize(initial, snakeGame, 5)), snapshot);
    assert.notEqual(out, initial);
  });
});

describe("benchmarkPolicy guards", () => {
  const endless: Game<number> = {
    id: "endless",
    actionCount: 1,
    reset: () => 0,
    step: (s) => ({ next: s + 1, reward: 0, done: false }),
    score: (s) => s,
    evalVariants: [{ label: "x", variant: 0 }],
  };

  it("throws on empty evalVariants", () => {
    assert.throws(() => benchmarkPolicy({ ...endless, evalVariants: [] }, () => () => 0), /no evalVariants/);
  });

  it("honours maxSteps", () => {
    assert.throws(() => benchmarkPolicy(endless, () => () => 0, { games: 1, maxSteps: 10 }), /did not end within 10 steps/);
  });

  it("rejects an invalid maxSteps", () => {
    assert.throws(() => benchmarkPolicy(endless, () => () => 0, { maxSteps: Infinity }), /maxSteps/);
  });
});
