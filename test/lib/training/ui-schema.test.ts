import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dqnAlgorithm } from "../../../src/lib/ai/algorithms/dqn.ts";
import { qLearningAlgorithm } from "../../../src/lib/ai/algorithms/q-learning.ts";
import { ARCHETYPES } from "../../../src/lib/game/fighter/world/archetypes.ts";
import { getGame } from "../../../src/lib/registry.ts";
import { ALGORITHM_UI, FIGHTER_ARCHETYPES, fighterGameId } from "../../../src/lib/training/ui-schema.ts";

const algorithms = { "q-learning": qLearningAlgorithm, dqn: dqnAlgorithm } as const;

describe("ALGORITHM_UI matches the algorithms", () => {
  for (const [id, ui] of Object.entries(ALGORITHM_UI) as [keyof typeof algorithms, (typeof ALGORITHM_UI)["dqn"]][]) {   // keys are the algorithm ids by type
    describe(id, () => {
      const algorithm = algorithms[id];
      const defaults = algorithm.defaultParams as Record<string, unknown>;   // plain object of numbers by construction

      it("episode limits", () => {
        assert.equal(ui.maxEpisodes, algorithm.PUBLIC_MAX_EPISODES);
        assert.ok(ui.defaultEpisodes >= 1 && ui.defaultEpisodes <= ui.maxEpisodes);
      });

      for (const field of ui.fields) {
        it(`field ${field.key}: known key, default equals the algorithm default, accepts default/min/max, rejects just outside`, () => {
          assert.ok(Object.hasOwn(defaults, field.key), "key exists in defaultParams");
          assert.equal(field.default, defaults[field.key]);
          for (const value of [field.default, field.min, field.max]) {
            assert.notEqual(algorithm.parseParams({ [field.key]: value }), null, `${field.key}=${value}`);
          }
          assert.equal(algorithm.parseParams({ [field.key]: field.min - field.step }), null, `${field.key} below min`);
          assert.equal(algorithm.parseParams({ [field.key]: field.max + field.step }), null, `${field.key} above max`);
          if (field.integer) assert.equal(algorithm.parseParams({ [field.key]: field.default + 0.5 }), null);
        });
      }

      it("does not expose hidden params", () => {
        const keys = ui.fields.map((f) => f.key);
        for (const hidden of ["hidden", "replaySize", "batchSize", "warmupSteps", "learnEvery", "targetSyncEvery", "epsilonStart"]) assert.ok(!keys.includes(hidden));
      });

      it("all defaults together are accepted", () => {
        assert.notEqual(algorithm.parseParams(Object.fromEntries(ui.fields.map((f) => [f.key, f.default]))), null);
      });
    });
  }
});

describe("FIGHTER_ARCHETYPES", () => {
  it("matches the fighter ARCHETYPES", () => {
    assert.deepEqual([...FIGHTER_ARCHETYPES], [...ARCHETYPES]);
  });

  for (const archetype of FIGHTER_ARCHETYPES) {
    it(`registers a game for ${archetype}`, () => {
      assert.ok(getGame(fighterGameId(archetype)));
    });
  }
});
