import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { snakeGame } from "../../../src/lib/game/snake-game.ts";
import { seededRng } from "../../../src/lib/rng.ts";
import { ALGORITHMS } from "../../../src/lib/registry.ts";

const TRAIN_PARAMS: Record<string, Record<string, unknown>> = {
  "q-learning": {},
  // Small network and buffers so a 30-episode run is quick
  dqn: { hidden: [16], replaySize: 2000, warmupSteps: 100, batchSize: 16, targetSyncEvery: 100 },
};

describe("algorithms on snakeGame", () => {
  for (const algorithm of Object.values(ALGORITHMS)) {
    describe(algorithm.id, () => {
      it("accepts its defaults", () => {
        assert.deepEqual(algorithm.parseParams(algorithm.defaultParams), algorithm.defaultParams);
        assert.deepEqual(algorithm.parseParams({}), algorithm.defaultParams);
      });

      it("rejects invalid params", () => {
        const defaults = algorithm.defaultParams as Record<string, unknown>;   // plain object of numbers/arrays by construction
        assert.equal(algorithm.parseParams(null), null);
        assert.equal(algorithm.parseParams([]), null);
        assert.equal(algorithm.parseParams({ ...defaults, evil: 1 }), null);
        assert.equal(algorithm.parseParams(JSON.parse('{"__proto__": {"gamma": 0.5}}')), null);
        assert.equal(algorithm.parseParams({ gamma: 1.5 }), null);
        assert.equal(algorithm.parseParams({ gamma: -0.1 }), null);
        assert.equal(algorithm.parseParams({ gamma: "0.9" }), null);
        assert.equal(algorithm.parseParams({ gamma: NaN }), null);
        assert.equal(algorithm.parseParams({ epsilonStart: 0.1, epsilonEnd: 0.5 }), null);
        assert.equal(algorithm.parseParams({ exploreFraction: 0 }), null);
      });

      it("rejects dqn-specific invalid params", () => {
        if (algorithm.id !== "dqn") return;
        assert.equal(algorithm.parseParams({ batchSize: 32.5 }), null);
        assert.equal(algorithm.parseParams({ batchSize: 0 }), null);
        assert.equal(algorithm.parseParams({ hidden: [4] }), null);
        assert.equal(algorithm.parseParams({ hidden: [300] }), null);
        assert.equal(algorithm.parseParams({ hidden: [16.5] }), null);
        assert.equal(algorithm.parseParams({ hidden: [16, 16, 16, 16] }), null);
        assert.equal(algorithm.parseParams({ hidden: [] }), null);
        assert.equal(algorithm.parseParams({ hidden: "64" }), null);
        assert.equal(algorithm.parseParams({ learnEvery: 0 }), null);
        assert.notEqual(algorithm.parseParams({ hidden: [8, 256, 64] }), null);
      });

      it("rejects q-learning-specific invalid params", () => {
        if (algorithm.id !== "q-learning") return;
        assert.equal(algorithm.parseParams({ alpha: 0 }), null);
        assert.equal(algorithm.parseParams({ alpha: 2 }), null);
      });

      it("trains, round-trips through JSON and keeps its policy", () => {
        const params = algorithm.parseParams(TRAIN_PARAMS[algorithm.id]);
        assert.ok(params);
        const model = algorithm.train(snakeGame, params, { episodes: 30, rng: seededRng(3) });
        const json: unknown = JSON.parse(JSON.stringify(algorithm.serialize(model, snakeGame, 30)));
        const restored = algorithm.parse(json, snakeGame);
        assert.ok(restored);

        const original = algorithm.createPolicy(model, snakeGame, seededRng(9));
        const loaded = algorithm.createPolicy(restored, snakeGame, seededRng(9));
        const rng = seededRng(4);
        for (let g = 0; g < 3; g++) {
          let state = snakeGame.reset(rng, 8);
          for (let i = 0; i < 40; i++) {
            const a = original(state);
            assert.equal(loaded(state), a);
            const { next, done } = snakeGame.step(state, a);
            state = next;
            if (done) break;
          }
        }
      });

      it("rejects a brain with the wrong featuresVersion", () => {
        const params = algorithm.parseParams(TRAIN_PARAMS[algorithm.id]);
        assert.ok(params);
        const model = algorithm.train(snakeGame, params, { episodes: 2, rng: seededRng(3) });
        const brain = algorithm.serialize(model, snakeGame, 2) as Record<string, unknown>;   // brain JSON shape is an object by contract
        assert.ok(algorithm.parse(brain, snakeGame));
        assert.equal(algorithm.parse({ ...brain, featuresVersion: 999 }, snakeGame), null);
        assert.equal(algorithm.parse({ ...brain, game: "other" }, snakeGame), null);
        assert.equal(algorithm.parse(null, snakeGame), null);
      });
    });
  }

  it("brain ids stay compatible with the existing files", () => {
    assert.equal(ALGORITHMS["q-learning"].brainGameId(snakeGame), "snake");
    assert.equal(ALGORITHMS["dqn"].brainGameId(snakeGame), "snake-dqn");
  });

  it("serialized q-learning brain has the same keys as public/brains/snake.json", () => {
    const algorithm = ALGORITHMS["q-learning"];
    const params = algorithm.parseParams({});
    assert.ok(params);
    const model = algorithm.train(snakeGame, params, { episodes: 2, rng: seededRng(1) });
    const fresh = algorithm.serialize(model, snakeGame, 2) as Record<string, unknown>;   // brain JSON shape is an object by contract
    const saved: unknown = JSON.parse(readFileSync("public/brains/snake.json", "utf8"));
    assert.deepEqual(Object.keys(fresh), Object.keys(saved as Record<string, unknown>));   // saved file is the same object shape
  });
});
