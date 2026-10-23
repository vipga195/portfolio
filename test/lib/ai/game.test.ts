import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toDenseEnv, toEnv } from "../../../src/lib/ai/game.ts";
import type { Game } from "../../../src/lib/ai/game.ts";

const base: Game<number> = {
  id: "counter",
  actionCount: 2,
  reset: () => 0,
  step: (state, action) => ({ next: state + action, reward: action, done: state + action >= 3 }),
  score: (state) => state,
  evalVariants: [{ label: "only", variant: 1 }],
};

describe("toEnv", () => {
  it("adapts the tabular representation", () => {
    const env = toEnv({ ...base, tabular: { stateCount: 4, featuresVersion: 7, encode: (s) => s } });
    assert.equal(env.id, "counter");
    assert.equal(env.stateCount, 4);
    assert.equal(env.actionCount, 2);
    assert.equal(env.featuresVersion, 7);
    assert.equal(env.encode(2), 2);
    assert.deepEqual(env.step(1, 1), { next: 2, reward: 1, done: false });
    assert.equal(env.score(3), 3);
  });

  it("uses the given id", () => {
    assert.equal(toEnv({ ...base, tabular: { stateCount: 4, featuresVersion: 1, encode: (s) => s } }, "other").id, "other");
  });

  it("throws when the game has no tabular representation", () => {
    assert.throws(() => toEnv(base), /no tabular representation/);
  });
});

describe("toDenseEnv", () => {
  it("adapts the dense representation", () => {
    const env = toDenseEnv({ ...base, dense: { observationSize: 1, featuresVersion: 3, observe: (s) => new Float32Array([s]) } }, "counter-dqn");
    assert.equal(env.id, "counter-dqn");
    assert.equal(env.observationSize, 1);
    assert.equal(env.featuresVersion, 3);
    assert.deepEqual(Array.from(env.observe(2)), [2]);
    assert.equal(env.reset(Math.random, 1), 0);
  });

  it("throws when the game has no dense representation", () => {
    assert.throws(() => toDenseEnv(base), /no dense representation/);
  });
});
