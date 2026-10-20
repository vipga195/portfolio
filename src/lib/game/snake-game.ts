// Snake as a platform Game: composed from the existing tabular (snakeEnv) and dense (snakeDqnEnv) adapters, no logic of its own.
import type { Game } from "../ai/game.ts";
import { snakeDqnEnv } from "./snake-dqn.ts";
import { snakeEnv } from "./snake-env.ts";
import type { SnakeEnvState } from "./snake-env.ts";

export const snakeGame: Game<SnakeEnvState> = {
  id: snakeEnv.id,
  actionCount: snakeEnv.actionCount,
  reset: (rng, variant) => snakeEnv.reset(rng, variant),
  step: (state, action) => snakeEnv.step(state, action),
  score: (state) => snakeEnv.score(state),
  evalVariants: snakeEnv.evalVariants,
  tabular: {
    stateCount: snakeEnv.stateCount,
    featuresVersion: snakeEnv.featuresVersion,
    encode: (state) => snakeEnv.encode(state),
  },
  dense: {
    observationSize: snakeDqnEnv.observationSize,
    featuresVersion: snakeDqnEnv.featuresVersion,
    observe: (state) => snakeDqnEnv.observe(state),
  },
};
