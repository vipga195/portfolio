import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { toDqnBrain, trainDqn, DEFAULT_DQN_OPTIONS } from '../../../src/lib/ai/dqn.ts';
import { createMlp } from '../../../src/lib/ai/nn.ts';
import { seededRng } from '../../../src/lib/rng.ts';
import { ACTIONS_VERSION, ACTION_COUNT, DECISION_FRAMES, actionFrames } from '../../../src/lib/game/fighter/world/actions.ts';
import { ARCHETYPES } from '../../../src/lib/game/fighter/world/archetypes.ts';
import { FEATURES_VERSION, FEATURE_COUNT, featurize } from '../../../src/lib/game/fighter/world/features.ts';
import { FIGHTER_BRAIN_SHAPE, createBrainNpc, npcStepBrain, parseFighterBrain } from '../../../src/lib/game/fighter/world/npc-brain.ts';
import type { FighterBrain, FighterBrainFile } from '../../../src/lib/game/fighter/world/npc-brain.ts';
import { createWorld, hashWorld, stepWorld } from '../../../src/lib/game/fighter/world/sim.ts';
import type { WorldState } from '../../../src/lib/game/fighter/world/sim.ts';
import { createTrainEnv, createTrainWorld, evaluateBrain, scriptedOpponent } from '../../../src/lib/game/fighter/world/train-env.ts';
import { WBIT } from '../../../src/lib/game/fighter/world/winputs.ts';

function randomBrain(seed: number): FighterBrain {
  const net = createMlp([FEATURE_COUNT, 16, ACTION_COUNT], seededRng(seed));
  return { net, archetype: 'aggressive', level: 'hard' };
}

function brainFile(seed: number): FighterBrainFile {
  const { net } = randomBrain(seed);
  return { ...toDqnBrain(FIGHTER_BRAIN_SHAPE, net, 1), archetype: 'combo', level: 'easy', actionsVersion: ACTIONS_VERSION, decisionFrames: DECISION_FRAMES };
}

// Plays random macros for both fighters and returns every visited world.
function wander(seed: number, ticks: number): WorldState[] {
  const rng = seededRng(seed);
  let world = createTrainWorld(rng);
  const seen: WorldState[] = [world];
  while (seen.length < ticks) {
    const frames = actionFrames(Math.floor(rng() * ACTION_COUNT), world, 'general');
    const foe = actionFrames(Math.floor(rng() * ACTION_COUNT), world, 'player');
    for (let i = 0; i < frames.length; i++) {
      world = stepWorld(world, [foe[i % foe.length], frames[i]]);
      seen.push(world);
    }
  }
  return seen;
}

describe('featurize', () => {
  test('fixed length, finite and within [-1, 1] on a wide sample of states, both sides', () => {
    for (const world of wander(3, 1500)) {
      for (const side of ['player', 'general'] as const) {
        const f = featurize(world, side);
        assert.equal(f.length, FEATURE_COUNT);
        for (const v of f) assert.ok(Number.isFinite(v) && v >= -1 && v <= 1, `out of range: ${v}`);
      }
    }
    assert.equal(typeof FEATURES_VERSION, 'number');
  });

  test('deterministic and does not mutate the world', () => {
    const world = createWorld(5);
    const before = hashWorld(world);
    assert.deepEqual(featurize(world, 'general'), featurize(world, 'general'));
    assert.equal(hashWorld(world), before);
  });

  test('the two sides see mirrored offsets', () => {
    const world = createWorld(5);
    const g = featurize(world, 'general');
    const p = featurize(world, 'player');
    assert.equal(g[0] + p[0], 0);
    assert.equal(g[1] + p[1], 0);
    assert.equal(g[3], p[5]);
  });
});

describe('actions', () => {
  test('every action gives valid masks of at least one decision interval', () => {
    const world = createWorld(1);
    for (let a = 0; a < ACTION_COUNT; a++) {
      const frames = actionFrames(a, world, 'general');
      assert.ok(frames.length >= DECISION_FRAMES);
      for (const m of frames) assert.ok(Number.isInteger(m) && m >= 0 && m < 1024);
    }
  });

  test('movement actions point toward, away and sideways relative to the opponent', () => {
    const world = createWorld(1); // general is east of the player
    assert.equal(actionFrames(1, world, 'general')[0] & WBIT.LEFT, WBIT.LEFT);
    assert.equal(actionFrames(2, world, 'general')[0] & WBIT.RIGHT, WBIT.RIGHT);
    assert.equal(actionFrames(5, world, 'general')[0] & WBIT.RUN, WBIT.RUN);
    const left = actionFrames(3, world, 'general')[0];
    assert.ok((left & (WBIT.UP | WBIT.DOWN)) !== 0 && (left & (WBIT.LEFT | WBIT.RIGHT)) === 0);
  });

  test('attack macros press once then release so the next press is fresh', () => {
    const frames = actionFrames(6, createWorld(1), 'general');
    assert.ok((frames[0] & WBIT.ATK_A) !== 0);
    assert.ok(frames.slice(1).every((m) => (m & (WBIT.ATK_A | WBIT.ATK_B | WBIT.ATK_C)) === 0));
  });

  test('the scripted macros trigger the intended moves in the sim', () => {
    const play = (action: number, setup: (w: WorldState) => WorldState = (w) => w): Set<string> => {
      let world = setup(createWorld(2));
      const moves = new Set<string>();
      for (let n = 0; n < 4; n++) {
        const frames = actionFrames(action, world, 'general');
        for (const m of frames) {
          world = stepWorld(world, [0, m]);
          if (world.general.move !== null) moves.add(world.general.move);
          world = { ...world, player: { ...world.player, hp: 1000, invuln: 0 } };
        }
      }
      return moves;
    };
    // Put the player right next to the general so attacks connect.
    const close = (w: WorldState): WorldState => ({ ...w, player: { ...w.player, x: w.general.x - 40 * 256, y: w.general.y } });
    assert.ok(play(10, close).has('uppercut'));
    assert.ok(play(11, close).has('spin'));
    assert.ok(play(12, close).has('dash'));
    assert.ok(play(13, close).has('lowKick'));
    const chain = play(9, close);
    assert.ok(chain.has('punch') && chain.has('kick'));
  });
});

describe('train env', () => {
  const rollout = (archetype: (typeof ARCHETYPES)[number], seed: number): { rewards: number[]; hash: number } => {
    const env = createTrainEnv(archetype);
    const rng = seededRng(seed);
    let state = env.reset(rng);
    const rewards: number[] = [];
    for (let i = 0; i < 400; i++) {
      const r = env.step(state, Math.floor(rng() * ACTION_COUNT));
      rewards.push(r.reward);
      state = r.next;
      if (r.done) break;
    }
    return { rewards, hash: hashWorld(state.world) };
  };

  test('same seed gives identical rewards and final state, for every archetype', () => {
    for (const a of ARCHETYPES) assert.deepEqual(rollout(a, 9), rollout(a, 9));
  });

  test('episodes always terminate within the tick cap and rewards are finite', () => {
    const env = createTrainEnv('weapon');
    const rng = seededRng(4);
    let state = env.reset(rng);
    let done = false;
    for (let i = 0; i < 1000 && !done; i++) {
      const r = env.step(state, 0);
      assert.ok(Number.isFinite(r.reward));
      state = r.next;
      done = r.done;
    }
    assert.ok(done);
  });

  test('a short training run produces a net of the right shape and is reproducible', () => {
    const train = (): string => {
      const rng = seededRng(21);
      const net = trainDqn(
        createTrainEnv('combo'),
        { ...DEFAULT_DQN_OPTIONS, episodes: 4, hidden: [8], warmupSteps: 50, replaySize: 2000, reportEvery: 100 },
        rng,
      );
      assert.deepEqual(net.sizes, [FEATURE_COUNT, 8, ACTION_COUNT]);
      return JSON.stringify(Array.from(net.weights[0]));
    };
    assert.equal(train(), train());
  });

  test('evaluation is deterministic', () => {
    const brain = randomBrain(2);
    assert.deepEqual(evaluateBrain(brain, scriptedOpponent, 3, 11), evaluateBrain(brain, scriptedOpponent, 3, 11));
  });
});

describe('npc brain', () => {
  test('parseFighterBrain accepts a valid file and rejects tampered ones', () => {
    const file = brainFile(1);
    const parsed = parseFighterBrain(JSON.parse(JSON.stringify(file)));
    assert.ok(parsed !== null);
    assert.equal(parsed.archetype, 'combo');
    assert.equal(parseFighterBrain(null), null);
    assert.equal(parseFighterBrain({ ...file, featuresVersion: FEATURES_VERSION + 1 }), null);
    assert.equal(parseFighterBrain({ ...file, actionsVersion: ACTIONS_VERSION + 1 }), null);
    assert.equal(parseFighterBrain({ ...file, archetype: 'nope' }), null);
    assert.equal(parseFighterBrain({ ...file, level: 'insane' }), null);
    assert.equal(parseFighterBrain({ ...file, game: 'snake' }), null);
    assert.equal(parseFighterBrain({ ...file, actionCount: ACTION_COUNT + 1 }), null);
  });

  test('forward pass is deterministic and Math.random is never used', () => {
    const brain = randomBrain(3);
    const original = Math.random;
    Math.random = (): number => {
      throw new Error('Math.random called');
    };
    try {
      const run = (epsilon: number): number[] => {
        let world = createWorld(8);
        let npc = createBrainNpc();
        const masks: number[] = [];
        for (let i = 0; i < 300; i++) {
          const [mask, next] = npcStepBrain(npc, world, brain, { epsilon });
          npc = next;
          masks.push(mask);
          world = stepWorld(world, [0, mask]);
        }
        return masks;
      };
      assert.deepEqual(run(0), run(0));
      assert.deepEqual(run(0.5), run(0.5));
      assert.notDeepEqual(run(0), run(1));
    } finally {
      Math.random = original;
    }
  });

  test('it emits one mask per frame, holding each macro for its full length', () => {
    const brain = randomBrain(4);
    const world = createWorld(1);
    let npc = createBrainNpc();
    const masks: number[] = [];
    for (let i = 0; i < DECISION_FRAMES; i++) {
      const [mask, next] = npcStepBrain(npc, world, brain);
      npc = next;
      masks.push(mask);
    }
    assert.equal(npc.index, DECISION_FRAMES);
    assert.ok(masks.every((m) => Number.isInteger(m) && m >= 0));
  });
});
