// Rebuilds a Snake game from (grid size, seed, the direction requested on every tick), the same way on the client and
// on a server that has to verify a submitted game. Pure; relative imports with .ts so Node can run it directly.
import { MAX_GRID_SIZE, MIN_GRID_SIZE, createInitialState, step } from "./snake.ts";
import type { Direction, GameState } from "./snake.ts";

const CHAR_TO_DIRECTION: Record<string, Direction> = { u: "up", d: "down", l: "left", r: "right" };
const DIRECTION_TO_CHAR: Record<Direction, string> = { up: "u", down: "d", left: "l", right: "r" };

// A game this long without ending (for example endless circling) is not accepted as a replay
const MAX_MOVES_PER_CELL = 4;

export function maxMoves(gridSize: number): number {
  return gridSize * gridSize * MAX_MOVES_PER_CELL;
}

export function encodeMoves(directions: readonly Direction[]): string {
  return directions.map((d) => DIRECTION_TO_CHAR[d]).join("");
}

// Inverse of encodeMoves; null when a character is not a move
export function decodeMoves(moves: string): Direction[] | null {
  const directions: Direction[] = [];
  for (const char of moves) {
    const direction = CHAR_TO_DIRECTION[char];
    if (!direction) return null;
    directions.push(direction);
  }
  return directions;
}

export type ReplayResult =
  | { ok: true; final: GameState; states: GameState[] }
  | { ok: false; reason: string };

// All input here is untrusted (it comes from a client): validate everything before running it
export function replay(gridSize: number, seed: number, moves: string): ReplayResult {
  if (!Number.isInteger(gridSize) || gridSize < MIN_GRID_SIZE || gridSize > MAX_GRID_SIZE) {
    return { ok: false, reason: "grid size out of range" };
  }
  if (!Number.isInteger(seed) || seed < 0 || seed >= 4294967296) {
    return { ok: false, reason: "seed must be an unsigned 32-bit integer" };
  }
  if (typeof moves !== "string" || moves.length === 0 || moves.length > maxMoves(gridSize)) {
    return { ok: false, reason: "invalid number of moves" };
  }

  let state = createInitialState(gridSize, seed);
  const states: GameState[] = [state];
  for (const char of moves) {
    const direction = CHAR_TO_DIRECTION[char];
    if (!direction) return { ok: false, reason: "unknown move character" };
    // Extra moves after the game ended mean the data was edited or invented
    if (!state.alive) return { ok: false, reason: "moves after the game ended" };
    state = step(state, direction);
    states.push(state);
  }
  return { ok: true, final: state, states };
}
