import { chooseAction, createQTable, updateQ } from "./qlearning.ts";
import type { QTable } from "./qlearning.ts";
import type { Env } from "./env.ts";

export type TrainOptions = {
  episodes: number;
  alpha: number;
  gamma: number;
  epsilonStart: number;
  epsilonEnd: number;
  // Epsilon falls linearly during this fraction of the episodes, then stays at epsilonEnd
  exploreFraction: number;
  // Called every `reportEvery` episodes with the average and best score of that window
  reportEvery: number;
  onProgress?: (info: { episode: number; epsilon: number; avg: number; best: number }) => void;
};

export const DEFAULT_TRAIN_OPTIONS: TrainOptions = {
  episodes: 20000,
  alpha: 0.1,
  gamma: 0.9,
  epsilonStart: 1,
  epsilonEnd: 0.02,
  exploreFraction: 0.6,
  reportEvery: 1000,
};

export function epsilonAt(episode: number, options: TrainOptions): number {
  const progress = Math.min(1, episode / (options.episodes * options.exploreFraction));
  return options.epsilonStart + (options.epsilonEnd - options.epsilonStart) * progress;
}

function runEpisode<S>(env: Env<S>, table: QTable, epsilon: number, options: TrainOptions, rng: () => number): number {
  let state = env.reset(rng);
  for (;;) {
    const s = env.encode(state);
    const action = chooseAction(table, s, epsilon, rng);
    const { next, reward, done } = env.step(state, action);
    updateQ(table, s, action, reward, env.encode(next), done, options.alpha, options.gamma);
    state = next;
    if (done) return env.score(state);
  }
}

export function train<S>(env: Env<S>, options: TrainOptions, rng: () => number = Math.random, initial?: QTable): QTable {
  // Resume from a previous table when given, otherwise start from all zeros
  const table = initial ?? createQTable(env.stateCount, env.actionCount);
  let total = 0;
  let best = 0;

  for (let episode = 1; episode <= options.episodes; episode++) {
    const score = runEpisode(env, table, epsilonAt(episode, options), options, rng);
    total += score;
    best = Math.max(best, score);
    if (episode % options.reportEvery === 0) {
      options.onProgress?.({ episode, epsilon: epsilonAt(episode, options), avg: total / options.reportEvery, best });
      total = 0;
      best = 0;
    }
  }
  return table;
}

// Greedy games (no exploration, no learning) to measure what the brain has actually learned
export function evaluate<S>(
  env: Env<S>,
  table: QTable,
  variant: number,
  games: number,
  rng: () => number = Math.random,
): { avg: number; best: number } {
  let total = 0;
  let best = 0;
  for (let g = 0; g < games; g++) {
    let state = env.reset(rng, variant);
    for (;;) {
      const { next, done } = env.step(state, chooseAction(table, env.encode(state), 0, rng));
      state = next;
      if (done) break;
    }
    const score = env.score(state);
    total += score;
    best = Math.max(best, score);
  }
  return { avg: total / games, best };
}
