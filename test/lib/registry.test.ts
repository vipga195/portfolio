import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dqnAlgorithm } from "../../src/lib/ai/algorithms/dqn.ts";
import { qLearningAlgorithm } from "../../src/lib/ai/algorithms/q-learning.ts";
import { snakeGame } from "../../src/lib/game/snake-game.ts";
import { getAlgorithm, getGame } from "../../src/lib/registry.ts";

describe("registry", () => {
  it("resolves known ids", () => {
    assert.equal(getGame("snake"), snakeGame);
    assert.equal(getAlgorithm("q-learning"), qLearningAlgorithm);
    assert.equal(getAlgorithm("dqn"), dqnAlgorithm);
  });

  it("returns undefined for unknown ids and prototype keys", () => {
    for (const id of ["nope", "", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      assert.equal(getGame(id), undefined, id);
      assert.equal(getAlgorithm(id), undefined, id);
    }
  });
});
