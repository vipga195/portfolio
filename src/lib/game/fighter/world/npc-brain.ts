import { nextRandom } from '../../../rng.ts';
import { argmax, parseDqnBrain } from '../../../ai/dqn.ts';
import type { DqnBrain, DqnBrainShape } from '../../../ai/dqn.ts';
import { forward } from '../../../ai/nn.ts';
import type { Mlp } from '../../../ai/nn.ts';
import type { InputMask } from '../inputs.ts';
import { ACTIONS_VERSION, ACTION_COUNT, DECISION_FRAMES, actionFrames } from './actions.ts';
import { ARCHETYPES, LEVELS, LEVEL_EPSILON } from './archetypes.ts';
import type { Archetype, Level } from './archetypes.ts';
import { FEATURES_VERSION, FEATURE_COUNT, featurize } from './features.ts';
import type { Side } from './features.ts';
import type { WorldState } from './sim.ts';

export const FIGHTER_BRAIN_ID = 'fighter-world';

export const FIGHTER_BRAIN_SHAPE: DqnBrainShape = {
  id: FIGHTER_BRAIN_ID,
  observationSize: FEATURE_COUNT,
  actionCount: ACTION_COUNT,
  featuresVersion: FEATURES_VERSION,
};

// The brain JSON file: the shared DQN format plus what this fighter needs to interpret it.
export type FighterBrainFile = DqnBrain & {
  archetype: Archetype;
  level: Level;
  actionsVersion: number;
  decisionFrames: number;
};

export type FighterBrain = { net: Mlp; archetype: Archetype; level: Level };

// A brain file is loaded over the network: validate everything before using it.
export function parseFighterBrain(input: unknown): FighterBrain | null {
  const net = parseDqnBrain(input, FIGHTER_BRAIN_SHAPE);
  if (net === null || typeof input !== 'object' || input === null) return null;
  const { archetype, level, actionsVersion, decisionFrames } = input as Partial<Record<keyof FighterBrainFile, unknown>>; // fields checked below
  if (actionsVersion !== ACTIONS_VERSION || decisionFrames !== DECISION_FRAMES) return null;
  if (typeof archetype !== 'string' || !ARCHETYPES.some((a) => a === archetype)) return null;
  if (typeof level !== 'string' || !LEVELS.some((l) => l === level)) return null;
  return { net, archetype: archetype as Archetype, level: level as Level }; // narrowed by the some() checks above
}

// The macro being played: its per-frame masks and the next one to emit.
export type BrainNpcState = { frames: InputMask[]; index: number };

export type BrainNpcOptions = {
  // Probability of a random action per decision, drawn from the sim's own rng (default 0 = pure argmax).
  epsilon?: number;
  // Which fighter the brain drives (default the general, like npcStepWorld).
  side?: Side;
};

export function createBrainNpc(): BrainNpcState {
  return { frames: [], index: 0 };
}

// Default exploration noise for a brain's level.
export function defaultEpsilon(brain: FighterBrain): number {
  return LEVEL_EPSILON[brain.level];
}

function chooseAction(brain: FighterBrain, world: WorldState, side: Side, epsilon: number): number {
  if (epsilon > 0) {
    const [roll, next] = nextRandom(world.rng);
    if (roll < epsilon) return Math.floor(nextRandom(next)[0] * ACTION_COUNT);
  }
  return argmax(forward(brain.net, featurize(world, side)));
}

// Pure, no Math.random: same contract as npcStepWorld. Returns this frame's input mask and the next state; a new
// action is chosen every DECISION_FRAMES frames (longer for scripted macros), the same cadence the brain trained at.
export function npcStepBrain(npc: BrainNpcState, world: WorldState, brain: FighterBrain, options: BrainNpcOptions = {}): [InputMask, BrainNpcState] {
  const side = options.side ?? 'general';
  let { frames, index } = npc;
  if (index >= frames.length) {
    frames = actionFrames(chooseAction(brain, world, side, options.epsilon ?? 0), world, side);
    index = 0;
  }
  return [frames[index], { frames, index: index + 1 }];
}
