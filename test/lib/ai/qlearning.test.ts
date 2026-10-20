import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { parseBrain, toBrain } from "../../../src/lib/ai/brain.ts";
import { chooseAction, createQTable, updateQ } from "../../../src/lib/ai/qlearning.ts";
import { DEFAULT_TRAIN_OPTIONS, epsilonAt, evaluate, train } from "../../../src/lib/ai/train.ts";
import type { Env } from "../../../src/lib/ai/env.ts";

describe("chooseAction", () => {
  test("greedy picks the action with the highest value", () => {
    const table = createQTable(10, 3);
    table.values[7 * 3 + 2] = 1;
    assert.equal(chooseAction(table, 7, 0), 2);
  });

  test("epsilon 1 explores using the rng", () => {
    const table = createQTable(10, 3);
    table.values[0] = 5;
    const values = [0, 0.99];
    let i = 0;
    const rng = (): number => values[i++ % values.length];
    // First rng() < 1 -> explore; second rng() = 0.99 picks the last of 3 actions
    assert.equal(chooseAction(table, 0, 1, rng), 2);
  });

  test("ties are broken randomly rather than always taking action 0", () => {
    const table = createQTable(10, 3);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(chooseAction(table, 3, 0));
    assert.equal(seen.size, 3);
  });
});

describe("updateQ", () => {
  test("applies the Q-learning update", () => {
    const table = createQTable(30, 3);
    table.values[10 * 3 + 0] = 1;
    table.values[20 * 3 + 1] = 4;
    // target = 2 + 0.5 * 4 = 4 ; Q = 1 + 0.5 * (4 - 1) = 2.5
    updateQ(table, 10, 0, 2, 20, false, 0.5, 0.5);
    assert.equal(table.values[10 * 3 + 0], 2.5);
  });

  test("a terminal transition ignores the next state", () => {
    const table = createQTable(30, 3);
    table.values[20 * 3 + 1] = 100;
    updateQ(table, 10, 0, -10, 20, true, 1, 0.9);
    assert.equal(table.values[10 * 3 + 0], -10);
  });
});

describe("brain serialization", () => {
  const shape = { id: "toy", stateCount: 4, actionCount: 2, featuresVersion: 1 };

  test("round-trips a Q-table", () => {
    const table = createQTable(4, 2);
    table.values[5] = 1.5;
    const parsed = parseBrain(JSON.parse(JSON.stringify(toBrain(shape, table, 10))), shape);
    assert.ok(parsed);
    assert.equal(parsed.values[5], 1.5);
  });

  test("records the features version in the brain file", () => {
    assert.equal(toBrain(shape, createQTable(4, 2), 0).featuresVersion, 1);
  });

  test("rejects a brain trained with another features version, even when the shape matches", () => {
    const old = toBrain({ ...shape, featuresVersion: 1 }, createQTable(4, 2), 0);
    assert.ok(parseBrain(old, shape));
    assert.equal(parseBrain(old, { ...shape, featuresVersion: 2 }), null);
  });

  test("rejects a brain file without a features version (written before versioning existed)", () => {
    const legacy: Record<string, unknown> = { ...toBrain(shape, createQTable(4, 2), 0) };
    delete legacy.featuresVersion;
    assert.equal(parseBrain(legacy, shape), null);
  });

  test("rejects malformed input and brains of another game", () => {
    const good = toBrain(shape, createQTable(4, 2), 0);
    assert.equal(parseBrain(null, shape), null);
    assert.equal(parseBrain({ ...good, version: 99 }, shape), null);
    assert.equal(parseBrain({ ...good, q: [1, 2, 3] }, shape), null);
    assert.equal(parseBrain({ ...good, game: "other" }, shape), null);
    assert.equal(parseBrain({ ...good, actionCount: 3 }, shape), null);
    assert.equal(parseBrain({ ...good, q: good.q.map((_, i) => (i === 0 ? Number.NaN : 0)) }, shape), null);
  });
});

// A tiny game: walk on a line of 5 cells from the middle; reaching the right end wins, the left end loses
type LineState = { pos: number; steps: number };
const lineEnv: Env<LineState> = {
  id: "line",
  stateCount: 5,
  actionCount: 2,
  featuresVersion: 1,
  reset: () => ({ pos: 2, steps: 0 }),
  encode: (s) => s.pos,
  step(s, action) {
    const pos = s.pos + (action === 1 ? 1 : -1);
    const steps = s.steps + 1;
    const won = pos === 4;
    const lost = pos === 0 || steps > 20;
    return { next: { pos, steps }, reward: won ? 1 : lost ? -1 : 0, done: won || lost };
  },
  score: (s) => (s.pos === 4 ? 1 : 0),
  evalVariants: [{ label: "line", variant: 0 }],
};

describe("train / evaluate", () => {
  test("epsilon decays linearly then stays at epsilonEnd", () => {
    const options = { ...DEFAULT_TRAIN_OPTIONS, episodes: 100, exploreFraction: 0.5, epsilonStart: 1, epsilonEnd: 0 };
    assert.equal(epsilonAt(0, options), 1);
    assert.equal(epsilonAt(25, options), 0.5);
    assert.equal(epsilonAt(50, options), 0);
    assert.equal(epsilonAt(100, options), 0);
  });

  test("learns a trivial game from scratch", () => {
    const table = train(lineEnv, { ...DEFAULT_TRAIN_OPTIONS, episodes: 2000, reportEvery: 1000 });
    const { avg } = evaluate(lineEnv, table, 0, 20);
    assert.equal(avg, 1);
  });
});
