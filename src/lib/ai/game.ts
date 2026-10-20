// A game as the training platform sees it: rules plus optional state representations.
// Algorithms pick the representation they need (tabular index or dense vector); toEnv / toDenseEnv adapt a Game
// to the existing Env / DenseEnv so train() and trainDqn() work on any Game unchanged.
// Method syntax on purpose: it lets a Game<SomeState> be stored in a registry typed Game<unknown>.
import type { DenseEnv } from "./dqn.ts";
import type { Env, StepResult } from "./env.ts";

export type { StepResult };

// Greedy action for a state
export type Policy<S> = (state: S) => number;

export type Game<S> = {
  id: string;
  actionCount: number;
  // `variant` is game-defined (for Snake: the grid size). Omitted -> pick a random one using rng.
  reset(rng: () => number, variant?: number): S;
  step(state: S, action: number): StepResult<S>;
  score(state: S): number;
  evalVariants: { label: string; variant: number }[];
  // Small discrete state space (Q-table)
  tabular?: {
    stateCount: number;
    // Bump whenever `encode` changes meaning
    featuresVersion: number;
    encode(state: S): number;
  };
  // Dense float observation (neural network)
  dense?: {
    observationSize: number;
    // Bump whenever `observe` changes meaning
    featuresVersion: number;
    observe(state: S): Float32Array;
  };
};

export function toEnv<S>(game: Game<S>, id: string = game.id): Env<S> {
  const { tabular } = game;
  if (!tabular) throw new Error(`Game "${game.id}" has no tabular representation`);
  return {
    id,
    stateCount: tabular.stateCount,
    actionCount: game.actionCount,
    featuresVersion: tabular.featuresVersion,
    reset: (rng, variant) => game.reset(rng, variant),
    encode: (state) => tabular.encode(state),
    step: (state, action) => game.step(state, action),
    score: (state) => game.score(state),
    evalVariants: game.evalVariants,
  };
}

export function toDenseEnv<S>(game: Game<S>, id: string = game.id): DenseEnv<S> {
  const { dense } = game;
  if (!dense) throw new Error(`Game "${game.id}" has no dense representation`);
  return {
    id,
    actionCount: game.actionCount,
    featuresVersion: dense.featuresVersion,
    observationSize: dense.observationSize,
    reset: (rng, variant) => game.reset(rng, variant),
    observe: (state) => dense.observe(state),
    step: (state, action) => game.step(state, action),
    score: (state) => game.score(state),
    evalVariants: game.evalVariants,
  };
}
