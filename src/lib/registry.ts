// Lookup of the games and algorithms the platform knows. Ids come from untrusted input, so lookups use Object.hasOwn.
import type { Algorithm } from "./ai/algorithm.ts";
import { dqnAlgorithm } from "./ai/algorithms/dqn.ts";
import { qLearningAlgorithm } from "./ai/algorithms/q-learning.ts";
import type { Game } from "./ai/game.ts";
import { snakeGame } from "./game/snake-game.ts";
import { fighterGames } from "./game/fighter/world/fighter-game.ts";

// Game<SnakeEnvState> is stored as Game<unknown>: all Game members use method syntax (bivariant parameters),
// so the assignment type-checks without a cast. If a member is ever changed to property syntax, add a cast here.
export const GAMES: Record<string, Game<unknown>> = {
  [snakeGame.id]: snakeGame,
  ...Object.fromEntries(fighterGames.map((g) => [g.id, g])),
};

export const ALGORITHMS: Record<string, Algorithm<unknown, unknown>> = {
  [qLearningAlgorithm.id]: qLearningAlgorithm,
  [dqnAlgorithm.id]: dqnAlgorithm,
};

export function getGame(id: string): Game<unknown> | undefined {
  return Object.hasOwn(GAMES, id) ? GAMES[id] : undefined;
}

export function getAlgorithm(id: string): Algorithm<unknown, unknown> | undefined {
  return Object.hasOwn(ALGORITHMS, id) ? ALGORITHMS[id] : undefined;
}
