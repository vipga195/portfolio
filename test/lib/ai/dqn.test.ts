import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DQN_OPTIONS,
  createReplay,
  epsilonAt,
  evaluateDqn,
  parseDqnBrain,
  pushReplay,
  toDqnBrain,
  trainDqn,
} from "../../../src/lib/ai/dqn.ts";
import type { DenseEnv } from "../../../src/lib/ai/dqn.ts";
import { createMlp } from "../../../src/lib/ai/nn.ts";

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Corridor of 6 cells, start in the middle. Action 1 = right, 0 = left. Reaching the right end scores 1 and wins.
type Corridor = { pos: number; steps: number };
const LENGTH = 6;
const corridorEnv: DenseEnv<Corridor> = {
  id: "corridor",
  actionCount: 2,
  featuresVersion: 1,
  observationSize: 2,
  reset: () => ({ pos: 2, steps: 0 }),
  observe: (s) => Float32Array.of(s.pos / LENGTH, 1),
  step(s, action) {
    const pos = Math.max(0, s.pos + (action === 1 ? 1 : -1));
    const steps = s.steps + 1;
    const won = pos >= LENGTH - 1;
    return { next: { pos, steps }, reward: won ? 1 : -0.05, done: won || steps >= 30 };
  },
  score: (s) => (s.pos >= LENGTH - 1 ? 1 : 0),
  evalVariants: [{ label: "corridor", variant: 0 }],
};

describe("epsilonAt", () => {
  test("decays linearly then stays at epsilonEnd", () => {
    const o = { ...DEFAULT_DQN_OPTIONS, episodes: 100, exploreFraction: 0.5, epsilonStart: 1, epsilonEnd: 0 };
    assert.equal(epsilonAt(0, o), 1);
    assert.equal(epsilonAt(25, o), 0.5);
    assert.equal(epsilonAt(80, o), 0);
  });
});

describe("replay buffer", () => {
  test("wraps around and overwrites the oldest transition", () => {
    const r = createReplay(3, 2);
    for (let i = 0; i < 5; i++) pushReplay(r, Float32Array.of(i, i), i % 2, i, Float32Array.of(i + 10, i + 10), i === 4);
    assert.equal(r.size, 3);
    assert.equal(r.cursor, 2);
    // Slots hold transitions 3, 4, 2
    assert.deepEqual(Array.from(r.rewards), [3, 4, 2]);
    assert.deepEqual(Array.from(r.obs.subarray(0, 2)), [3, 3]);
    assert.deepEqual(Array.from(r.nextObs.subarray(2, 4)), [14, 14]);
    assert.deepEqual(Array.from(r.dones), [0, 1, 0]);
  });
});

describe("trainDqn", () => {
  test("learns the corridor", () => {
    const rng = seeded(42);
    const net = trainDqn(
      corridorEnv,
      { ...DEFAULT_DQN_OPTIONS, episodes: 300, hidden: [16], reportEvery: 100, warmupSteps: 100, targetSyncEvery: 100, replaySize: 5000, batchSize: 32 },
      rng,
    );
    const { avg } = evaluateDqn(corridorEnv, net, 0, 10, rng);
    assert.equal(avg, 1);
  });
});

describe("dqn brain", () => {
  const shape = { id: "corridor", observationSize: 2, actionCount: 2, featuresVersion: 1 };
  const net = createMlp([2, 4, 2], seeded(1));

  test("round trips through JSON", () => {
    const parsed = parseDqnBrain(JSON.parse(JSON.stringify(toDqnBrain(shape, net, 10))), shape);
    assert.ok(parsed);
    assert.deepEqual(parsed.sizes, [2, 4, 2]);
  });

  test("rejects mismatches and bad data", () => {
    const brain = toDqnBrain(shape, net, 10);
    assert.equal(parseDqnBrain(null, shape), null);
    assert.equal(parseDqnBrain({ ...brain, game: "other" }, shape), null);
    assert.equal(parseDqnBrain({ ...brain, version: 99 }, shape), null);
    assert.equal(parseDqnBrain({ ...brain, featuresVersion: 2 }, shape), null);
    assert.equal(parseDqnBrain({ ...brain, observationSize: 3 }, shape), null);
    assert.equal(parseDqnBrain({ ...brain, actionCount: 3 }, shape), null);
    assert.equal(parseDqnBrain({ ...brain, net: null }, shape), null);
    // Header matches but the network itself has other input/output sizes
    const other = toDqnBrain(shape, createMlp([3, 4, 2], seeded(2)), 10);
    assert.equal(parseDqnBrain({ ...brain, net: other.net }, shape), null);
    const badOut = toDqnBrain(shape, createMlp([2, 4, 3], seeded(3)), 10);
    assert.equal(parseDqnBrain({ ...brain, net: badOut.net }, shape), null);
  });
});
