import { assertEpisodes, hasOnlyKeys, inRange, isPlainObject, pick } from "../algorithm.ts";
import type { Algorithm } from "../algorithm.ts";
import { DEFAULT_DQN_OPTIONS, argmax, parseDqnBrain, toDqnBrain, trainDqn } from "../dqn.ts";
import type { DqnBrainShape } from "../dqn.ts";
import { toDenseEnv } from "../game.ts";
import type { Game } from "../game.ts";
import { cloneMlp, forward } from "../nn.ts";
import type { Mlp } from "../nn.ts";

export type DqnParams = {
  lr: number;
  gamma: number;
  batchSize: number;
  replaySize: number;
  hidden: number[];
  warmupSteps: number;
  learnEvery: number;
  targetSyncEvery: number;
  epsilonStart: number;
  epsilonEnd: number;
  exploreFraction: number;
};

const KEYS = [
  "lr", "gamma", "batchSize", "replaySize", "hidden", "warmupSteps", "learnEvery", "targetSyncEvery",
  "epsilonStart", "epsilonEnd", "exploreFraction",
] as const;

const MAX_HIDDEN_LAYERS = 3;

const defaultParams: DqnParams = {
  lr: DEFAULT_DQN_OPTIONS.lr,
  gamma: DEFAULT_DQN_OPTIONS.gamma,
  batchSize: DEFAULT_DQN_OPTIONS.batchSize,
  replaySize: DEFAULT_DQN_OPTIONS.replaySize,
  hidden: [...DEFAULT_DQN_OPTIONS.hidden],
  warmupSteps: DEFAULT_DQN_OPTIONS.warmupSteps,
  learnEvery: DEFAULT_DQN_OPTIONS.learnEvery,
  targetSyncEvery: DEFAULT_DQN_OPTIONS.targetSyncEvery,
  epsilonStart: DEFAULT_DQN_OPTIONS.epsilonStart,
  epsilonEnd: DEFAULT_DQN_OPTIONS.epsilonEnd,
  exploreFraction: DEFAULT_DQN_OPTIONS.exploreFraction,
};

function brainGameId(game: Game<unknown>): string {
  return `${game.id}-dqn`;
}

function brainShape(game: Game<unknown>): DqnBrainShape | null {
  if (!game.dense) return null;
  return {
    id: brainGameId(game),
    observationSize: game.dense.observationSize,
    actionCount: game.actionCount,
    featuresVersion: game.dense.featuresVersion,
  };
}

function parseHidden(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HIDDEN_LAYERS) return null;
  const sizes: number[] = [];
  for (const size of value) {
    if (!inRange(size, 8, 256, true)) return null;
    sizes.push(size);
  }
  return sizes;
}

export const dqnAlgorithm: Algorithm<DqnParams, Mlp> = {
  id: "dqn",
  label: "Double DQN (neural network)",
  defaultParams,
  PUBLIC_MAX_EPISODES: 5_000,
  parseParams(input) {
    if (!isPlainObject(input) || !hasOnlyKeys(input, KEYS)) return null;
    const lr = pick(input, "lr", defaultParams.lr);
    const gamma = pick(input, "gamma", defaultParams.gamma);
    const batchSize = pick(input, "batchSize", defaultParams.batchSize);
    const replaySize = pick(input, "replaySize", defaultParams.replaySize);
    const hidden = parseHidden(pick(input, "hidden", defaultParams.hidden));
    const warmupSteps = pick(input, "warmupSteps", defaultParams.warmupSteps);
    const learnEvery = pick(input, "learnEvery", defaultParams.learnEvery);
    const targetSyncEvery = pick(input, "targetSyncEvery", defaultParams.targetSyncEvery);
    const epsilonStart = pick(input, "epsilonStart", defaultParams.epsilonStart);
    const epsilonEnd = pick(input, "epsilonEnd", defaultParams.epsilonEnd);
    const exploreFraction = pick(input, "exploreFraction", defaultParams.exploreFraction);
    if (!hidden) return null;
    if (!inRange(lr, Number.MIN_VALUE, 1, false)) return null;
    if (!inRange(gamma, 0, 1, false)) return null;
    // Caps bound memory (replay buffer) and CPU (batch work per environment step) for public callers
    if (!inRange(batchSize, 8, 256, true)) return null;
    if (!inRange(replaySize, 1_000, 100_000, true) || replaySize < batchSize) return null;
    if (!inRange(learnEvery, 1, 32, true) || batchSize / learnEvery > 64) return null;
    if (!inRange(warmupSteps, 0, 100_000, true)) return null;
    if (!inRange(targetSyncEvery, 1, 100_000, true)) return null;
    if (!inRange(epsilonStart, 0, 1, false) || !inRange(epsilonEnd, 0, 1, false) || epsilonEnd > epsilonStart) return null;
    if (!inRange(exploreFraction, Number.MIN_VALUE, 1, false)) return null;
    return { lr, gamma, batchSize, replaySize, hidden, warmupSteps, learnEvery, targetSyncEvery, epsilonStart, epsilonEnd, exploreFraction };
  },
  brainGameId,
  train(game, params, { episodes, rng, onProgress, initial }) {
    assertEpisodes(episodes);
    const env = toDenseEnv(game, brainGameId(game));
    // Train on a copy so the caller's model is never mutated. With `initial`, params.hidden is ignored: the net keeps its own shape.
    return trainDqn(
      env,
      {
        ...params,
        episodes,
        reportEvery: Math.max(1, Math.floor(episodes / 20)),
        onProgress,
      },
      rng,
      initial ? cloneMlp(initial) : undefined,
    );
  },
  createPolicy(model, game, rng) {
    const env = toDenseEnv(game);
    return (state) => {
      const values = forward(model, env.observe(state));
      const best = values[argmax(values)];
      const ties: number[] = [];
      for (let a = 0; a < values.length; a++) if (values[a] === best) ties.push(a);
      // rng is only consumed on an exact tie, so a seeded run stays reproducible
      return ties.length === 1 ? ties[0] : ties[Math.floor(rng() * ties.length)];
    };
  },
  serialize(model, game, episodes) {
    const shape = brainShape(game);
    if (!shape) throw new Error(`Game "${game.id}" has no dense representation`);
    return toDqnBrain(shape, model, episodes);
  },
  parse(input, game) {
    const shape = brainShape(game);
    return shape ? parseDqnBrain(input, shape) : null;
  },
};
