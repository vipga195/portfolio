import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getGame } from '../../../src/lib/registry.ts';
import { dqnAlgorithm } from '../../../src/lib/ai/algorithms/dqn.ts';
import { benchmarkPolicy } from '../../../src/lib/ai/benchmark.ts';
import { seededRng } from '../../../src/lib/rng.ts';
import { ACTION_COUNT } from '../../../src/lib/game/fighter/world/actions.ts';
import { ARCHETYPES } from '../../../src/lib/game/fighter/world/archetypes.ts';
import { fighterGameId } from '../../../src/lib/game/fighter/world/fighter-game.ts';

describe('fighter games', () => {
  test('registry resolves every fighter archetype', () => {
    for (const archetype of ARCHETYPES) {
      assert.notEqual(getGame(fighterGameId(archetype)), undefined);
    }
    assert.equal(getGame('fighter-nope'), undefined);
    assert.equal(getGame('__proto__'), undefined);
  });

  test('dqn trains, serializes and parses the fighter-combo game', () => {
    const game = getGame('fighter-combo');
    if (game === undefined) throw new Error('fighter-combo missing');
    const params = { ...dqnAlgorithm.defaultParams, warmupSteps: 0, replaySize: 1000, batchSize: 8, hidden: [8] };
    const model = dqnAlgorithm.train(game, params, { episodes: 3, rng: seededRng(1) });
    const brain = dqnAlgorithm.serialize(model, game, 3);
    const parsed = dqnAlgorithm.parse(JSON.parse(JSON.stringify(brain)), game);
    assert.notEqual(parsed, null);
    assert.equal(typeof brain === 'object' && brain !== null && 'actionCount' in brain ? brain.actionCount : undefined, ACTION_COUNT);
  });

  test('benchmark is finite and deterministic on fighter-combo', () => {
    const game = getGame('fighter-combo');
    if (game === undefined) throw new Error('fighter-combo missing');
    const run = () => benchmarkPolicy(game, () => () => 0, { games: 2 });
    const first = run();
    assert.ok(Number.isFinite(first.overall));
    assert.deepEqual(run(), first);
  });
});
