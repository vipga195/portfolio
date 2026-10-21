// Turns a submitted Snake game into agent transitions: the server rebuilds the game itself and recomputes every
// reward, so nothing the client claims (scores, rewards) is trusted. Relative imports with .ts so Node can run it.
import type { Transition } from "../ai/env.ts";
import { decodeMoves, replay } from "./replay.ts";
import { directionToAction, snakeEnv } from "./snake-env.ts";
import type { SnakeEnvState } from "./snake-env.ts";
import type { GameState } from "./snake.ts";

export type TransitionsResult =
  | { ok: true; transitions: Transition<SnakeEnvState>[]; final: GameState }
  | { ok: false; reason: string };

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function sameGame(a: GameState, b: GameState): boolean {
  return (
    a.gridSize === b.gridSize &&
    a.dir === b.dir &&
    a.score === b.score &&
    a.alive === b.alive &&
    a.won === b.won &&
    a.seed === b.seed &&
    samePoint(a.food, b.food) &&
    a.snake.length === b.snake.length &&
    a.snake.every((p, i) => samePoint(p, b.snake[i])) &&
    a.bulges.length === b.bulges.length &&
    a.bulges.every((v, i) => v === b.bulges[i])
  );
}

// Validates the game with `replay`, then walks it again through snakeEnv.step to get (state, action, reward, next, done).
// The two walks must agree on every state; a mismatch means a bug or tampered data and the whole game is rejected.
export function snakeTransitionsFromMoves(gridSize: number, seed: number, moves: string): TransitionsResult {
  const result = replay(gridSize, seed, moves);
  if (!result.ok) return result;
  const directions = decodeMoves(moves);
  if (!directions) return { ok: false, reason: "unknown move character" };

  const transitions: Transition<SnakeEnvState>[] = [];
  let state: SnakeEnvState = { game: result.states[0], sinceFood: 0 };
  for (let t = 0; t < directions.length; t++) {
    const action = directionToAction(state.game.dir, directions[t]);
    const { next, reward, done } = snakeEnv.step(state, action);
    if (!sameGame(next.game, result.states[t + 1])) return { ok: false, reason: "replay mismatch" };
    transitions.push({ state, action, reward, next, done });
    // The episode ends here (death, win, or the stuck limit): moves after it are not learned from
    if (done) break;
    state = next;
  }
  return { ok: true, transitions, final: result.final };
}
