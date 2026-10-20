import { assertEpisodes, hasOnlyKeys, inRange, isPlainObject, pick } from "../algorithm.ts";
import type { Algorithm } from "../algorithm.ts";
import { parseBrain, toBrain } from "../brain.ts";
import type { BrainShape } from "../brain.ts";
import { toEnv } from "../game.ts";
import type { Game } from "../game.ts";
import { chooseAction } from "../qlearning.ts";
import type { QTable } from "../qlearning.ts";
import { DEFAULT_TRAIN_OPTIONS, train } from "../train.ts";

export type QLearningParams = {
  alpha: number;
  gamma: number;
  epsilonStart: number;
  epsilonEnd: number;
  exploreFraction: number;
};

const KEYS = ["alpha", "gamma", "epsilonStart", "epsilonEnd", "exploreFraction"] as const;

const defaultParams: QLearningParams = {
  alpha: DEFAULT_TRAIN_OPTIONS.alpha,
  gamma: DEFAULT_TRAIN_OPTIONS.gamma,
  epsilonStart: DEFAULT_TRAIN_OPTIONS.epsilonStart,
  epsilonEnd: DEFAULT_TRAIN_OPTIONS.epsilonEnd,
  exploreFraction: DEFAULT_TRAIN_OPTIONS.exploreFraction,
};

function brainGameId(game: Game<unknown>): string {
  return game.id;
}

function brainShape(game: Game<unknown>): BrainShape | null {
  if (!game.tabular) return null;
  return {
    id: brainGameId(game),
    stateCount: game.tabular.stateCount,
    actionCount: game.actionCount,
    featuresVersion: game.tabular.featuresVersion,
  };
}

export const qLearningAlgorithm: Algorithm<QLearningParams, QTable> = {
  id: "q-learning",
  label: "Q-learning (table)",
  defaultParams,
  PUBLIC_MAX_EPISODES: 20_000,
  parseParams(input) {
    if (!isPlainObject(input) || !hasOnlyKeys(input, KEYS)) return null;
    const alpha = pick(input, "alpha", defaultParams.alpha);
    const gamma = pick(input, "gamma", defaultParams.gamma);
    const epsilonStart = pick(input, "epsilonStart", defaultParams.epsilonStart);
    const epsilonEnd = pick(input, "epsilonEnd", defaultParams.epsilonEnd);
    const exploreFraction = pick(input, "exploreFraction", defaultParams.exploreFraction);
    if (!inRange(alpha, Number.MIN_VALUE, 1, false)) return null;
    if (!inRange(gamma, 0, 1, false)) return null;
    if (!inRange(epsilonStart, 0, 1, false) || !inRange(epsilonEnd, 0, 1, false) || epsilonEnd > epsilonStart) return null;
    if (!inRange(exploreFraction, Number.MIN_VALUE, 1, false)) return null;
    return { alpha, gamma, epsilonStart, epsilonEnd, exploreFraction };
  },
  brainGameId,
  train(game, params, { episodes, rng, onProgress, initial }) {
    assertEpisodes(episodes);
    const env = toEnv(game, brainGameId(game));
    // Train on a copy so the caller's model is never mutated
    const start = initial ? { ...initial, values: Float64Array.from(initial.values) } : undefined;
    return train(
      env,
      {
        ...params,
        episodes,
        reportEvery: Math.max(1, Math.floor(episodes / 20)),
        onProgress,
      },
      rng,
      start,
    );
  },
  createPolicy(model, game, rng) {
    const env = toEnv(game);
    return (state) => chooseAction(model, env.encode(state), 0, rng);
  },
  serialize(model, game, episodes) {
    const shape = brainShape(game);
    if (!shape) throw new Error(`Game "${game.id}" has no tabular representation`);
    return toBrain(shape, model, episodes);
  },
  parse(input, game) {
    const shape = brainShape(game);
    return shape ? parseBrain(input, shape) : null;
  },
};
