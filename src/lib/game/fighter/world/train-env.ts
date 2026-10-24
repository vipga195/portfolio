import { seededRng } from '../../../rng.ts';
import type { DenseEnv } from '../../../ai/dqn.ts';
import { BODY_HALF_WIDTH, MAX_HP, SUB } from '../frame-data.ts';
import type { InputMask } from '../inputs.ts';
import { ACTION_COUNT, actionFrames } from './actions.ts';
import { REWARD_WEIGHTS } from './archetypes.ts';
import type { Archetype, RewardWeights } from './archetypes.ts';
import { FEATURES_VERSION, FEATURE_COUNT, featurize } from './features.ts';
import { createWorldNpc, npcStepWorld } from './npc.ts';
import { npcStepBrain, createBrainNpc } from './npc-brain.ts';
import type { FighterBrain } from './npc-brain.ts';
import { WORLD_MOVES } from './moves.ts';
import { WORLD_HEIGHT, WORLD_WIDTH, createWorld, stepWorld } from './sim.ts';
import type { Actor, WorldState } from './sim.ts';

export const TRAIN_ENV_ID = 'fighter-world';
// Episode cap in sim frames (20 s at 60 FPS); reaching it ends the episode without a kill.
export const MAX_EPISODE_TICKS = 1200;

const START_JITTER_PX = 150;
const REACH_PX = WORLD_MOVES.kick.reachPx + BODY_HALF_WIDTH;
const DISTANCE_SCALE_PX = 400;
const SPECIAL_MOVES: readonly string[] = ['uppercut', 'spin', 'dash', 'blink', 'burst', 'fireball', 'wave'];

// The opponent always sits on the `player` side and answers with one input mask per sim frame. It may keep state in
// a closure; a fresh one is created per episode from a seed.
export type Opponent = (world: WorldState) => InputMask;
export type OpponentFactory = (seed: number) => Opponent;

// World with the two fighters swapped, so general-side code (npcStepWorld) can drive the player side.
function mirror(world: WorldState): WorldState {
  return { ...world, player: world.general, general: world.player };
}

// Level-1 scripted NPC, playing the player side.
export const scriptedOpponent: OpponentFactory = (seed) => {
  let npc = createWorldNpc(seed);
  return (world) => {
    const [mask, next] = npcStepWorld(npc, mirror(world));
    npc = next;
    return mask;
  };
};

// A frozen brain playing the player side (self-play).
export function brainOpponent(brain: FighterBrain, epsilon = 0): OpponentFactory {
  return () => {
    let npc = createBrainNpc();
    return (world) => {
      const [mask, next] = npcStepBrain(npc, world, brain, { side: 'player', epsilon });
      npc = next;
      return mask;
    };
  };
}

export type TrainState = {
  world: WorldState;
  opponent: Opponent;
  timedOut: boolean;
};

// Randomised start: both fighters shifted and turned, so the learner meets many spacings and facings.
export function createTrainWorld(rng: () => number): WorldState {
  const world = createWorld(Math.floor(rng() * 4294967296), { playerSkills: true, generalSkills: true });
  const place = (a: Actor): Actor => ({
    ...a,
    x: clampPx(a.x / SUB + (rng() * 2 - 1) * START_JITTER_PX, WORLD_WIDTH) * SUB,
    y: clampPx(a.y / SUB + (rng() * 2 - 1) * START_JITTER_PX, WORLD_HEIGHT) * SUB,
    dir: Math.floor(rng() * 16),
  });
  return { ...world, player: place(world.player), general: place(world.general) };
}

function clampPx(v: number, size: number): number {
  return Math.round(Math.min(size - 2 * BODY_HALF_WIDTH, Math.max(2 * BODY_HALF_WIDTH, v)));
}

function distPx(world: WorldState): number {
  const dx = (world.player.x - world.general.x) / SUB;
  const dy = (world.player.y - world.general.y) / SUB;
  return Math.sqrt(dx * dx + dy * dy);
}

export function isOver(state: TrainState): boolean {
  return state.world.player.state === 'dead' || state.world.general.state === 'dead' || state.timedOut;
}

// 1 = the learner wins (killed the opponent, or leads on hp at the time cap), -1 = loses, 0 = draw.
export function outcome(world: WorldState): 1 | 0 | -1 {
  const diff = world.general.hp - world.player.hp;
  return diff > 0 ? 1 : diff < 0 ? -1 : 0;
}

// Training env for the `general` side (the side an NPC plays in the open world) against `opponentFactory`.
export function createTrainEnv(archetype: Archetype, opponentFactory: OpponentFactory = scriptedOpponent): DenseEnv<TrainState> {
  const w: RewardWeights = REWARD_WEIGHTS[archetype];
  return {
    id: TRAIN_ENV_ID,
    featuresVersion: FEATURES_VERSION,
    observationSize: FEATURE_COUNT,
    actionCount: ACTION_COUNT,
    evalVariants: [],
    reset(rng: () => number): TrainState {
      const world = createTrainWorld(rng);
      return { world, opponent: opponentFactory(Math.floor(rng() * 4294967296)), timedOut: false };
    },
    observe(state: TrainState): Float32Array {
      return Float32Array.from(featurize(state.world, 'general'));
    },
    score(state: TrainState): number {
      return (state.world.general.hp - state.world.player.hp) / MAX_HP;
    },
    step(state: TrainState, action: number): { next: TrainState; reward: number; done: boolean } {
      let world = state.world;
      const distBefore = distPx(world);
      let dealt = 0;
      let taken = 0;
      let chainHits = 0;
      let specialHits = 0;
      let weaponHits = 0;
      let pickups = 0;
      let timedOut = false;
      for (const mask of actionFrames(action, world, 'general')) {
        const prev = world;
        world = stepWorld(world, [state.opponent(world), mask]);
        const foeLoss = prev.player.hp - world.player.hp;
        dealt += foeLoss;
        taken += prev.general.hp - world.general.hp;
        if (foeLoss > 0 && world.general.state === 'attack' && world.general.move !== null) {
          const move = world.general.move;
          if (world.general.chain >= 2) chainHits++;
          if (SPECIAL_MOVES.includes(move)) specialHits++;
          if (WORLD_MOVES[move].armed) weaponHits++;
        }
        if (prev.general.weapon === null && world.general.weapon !== null) pickups++;
        if (world.player.state === 'dead' || world.general.state === 'dead') break;
        if (world.tick >= MAX_EPISODE_TICKS) {
          timedOut = true;
          break;
        }
      }
      const next: TrainState = { world, opponent: state.opponent, timedOut };
      const done = isOver(next);
      const distAfter = distPx(world);
      let reward = (w.dealt * dealt - w.taken * taken) / MAX_HP;
      reward += w.chainHit * chainHits + w.specialHit * specialHits + w.weaponHit * weaponHits + w.pickup * pickups;
      if (distBefore > REACH_PX) reward += (w.approach * (distBefore - distAfter)) / DISTANCE_SCALE_PX;
      else reward += (w.retreat * (distAfter - distBefore)) / DISTANCE_SCALE_PX;
      reward -= w.step;
      if (world.player.state === 'dead') reward += w.win;
      if (world.general.state === 'dead') reward -= w.lose;
      if (timedOut && world.player.state !== 'dead' && world.general.state !== 'dead') reward -= w.timeout;
      return { next, reward, done };
    },
  };
}

export type MatchResult = { wins: number; losses: number; draws: number; kills: number; avgHpDiff: number };

// Plays `matches` seeded games of the brain (as general, through the real npcStepBrain path) against the opponent.
export function evaluateBrain(brain: FighterBrain, opponentFactory: OpponentFactory, matches: number, seed: number, epsilon = 0): MatchResult {
  const result: MatchResult = { wins: 0, losses: 0, draws: 0, kills: 0, avgHpDiff: 0 };
  let hpDiff = 0;
  for (let m = 0; m < matches; m++) {
    const rng = seededRng((seed + m * 7919) >>> 0);
    let world = createTrainWorld(rng);
    const opponent = opponentFactory(Math.floor(rng() * 4294967296));
    let npc = createBrainNpc();
    while (world.tick < MAX_EPISODE_TICKS && world.player.state !== 'dead' && world.general.state !== 'dead') {
      const [mask, next] = npcStepBrain(npc, world, brain, { epsilon });
      npc = next;
      world = stepWorld(world, [opponent(world), mask]);
    }
    const o = outcome(world);
    if (o > 0) result.wins++;
    else if (o < 0) result.losses++;
    else result.draws++;
    if (world.player.state === 'dead') result.kills++;
    hpDiff += (world.general.hp - world.player.hp) / MAX_HP;
  }
  result.avgHpDiff = hpDiff / matches;
  return result;
}
