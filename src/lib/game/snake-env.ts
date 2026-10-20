// Snake adapter for the generic Q-learning code in src/lib/ai: what the snake sees, which actions it has,
// and how it is rewarded. Relative imports with the .ts extension so Node can run this file directly.
import { chooseAction } from "../ai/qlearning.ts";
import type { QTable } from "../ai/qlearning.ts";
import type { Env } from "../ai/env.ts";
import { MAX_GRID_SIZE, MIN_GRID_SIZE, VECTORS, createInitialState, isOutOfBounds, step } from "./snake.ts";
import type { Direction, GameState, Point } from "./snake.ts";

// Relative to the heading: 0 = keep going, 1 = turn left, 2 = turn right (never a 180-degree turn)
const ACTION_COUNT = 3;
// 3 "cramped" bits (wall, body, or a pocket too small for the snake) + 4 heading bits + 4 food-side bits
const FEATURE_BITS = 11;
const STATE_COUNT = 1 << FEATURE_BITS;

export const REWARD_EAT = 10;
export const REWARD_DIE = -10;
const REWARD_CLOSER = 0.1;
const REWARD_FARTHER = -0.1;

const LEFT_OF: Record<Direction, Direction> = { up: "left", left: "down", down: "right", right: "up" };
const RIGHT_OF: Record<Direction, Direction> = { up: "right", right: "down", down: "left", left: "up" };
const HEADINGS: readonly Direction[] = ["up", "down", "left", "right"];

export function actionToDirection(heading: Direction, action: number): Direction {
  if (action === 1) return LEFT_OF[heading];
  if (action === 2) return RIGHT_OF[heading];
  return heading;
}

// Cells occupied by the snake. The game treats every segment (tail included) as an obstacle, so do the same here.
export function occupiedCells(state: GameState): Uint8Array {
  const occupied = new Uint8Array(state.gridSize * state.gridSize);
  for (const p of state.snake) occupied[p.y * state.gridSize + p.x] = 1;
  return occupied;
}

// True when stepping in `dir` leads into a wall, the body, or a pocket with fewer free cells than the snake is long.
// Flood fill from the next cell; it stops as soon as `snake.length` free cells are found, so it stays cheap in open space.
export function isCramped(state: GameState, occupied: Uint8Array, dir: Direction): boolean {
  const { gridSize, snake } = state;
  const next: Point = { x: snake[0].x + VECTORS[dir].x, y: snake[0].y + VECTORS[dir].y };
  if (isOutOfBounds(next, gridSize) || occupied[next.y * gridSize + next.x]) return true;

  const seen = occupied.slice();
  const start = next.y * gridSize + next.x;
  const stack = [start];
  seen[start] = 1;
  let free = 0;
  for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
    if (++free >= snake.length) return false;
    const x = cell % gridSize;
    const y = (cell - x) / gridSize;
    const neighbours = [
      x > 0 ? cell - 1 : -1,
      x < gridSize - 1 ? cell + 1 : -1,
      y > 0 ? cell - gridSize : -1,
      y < gridSize - 1 ? cell + gridSize : -1,
    ];
    for (const n of neighbours) {
      if (n >= 0 && !seen[n]) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return true;
}

// Packs what the snake "sees" into an integer in [0, STATE_COUNT). Nothing here depends on the grid size.
export function snakeFeatures(state: GameState): number {
  const head = state.snake[0];
  const occupied = occupiedCells(state);
  const bits = [
    isCramped(state, occupied, state.dir),
    isCramped(state, occupied, LEFT_OF[state.dir]),
    isCramped(state, occupied, RIGHT_OF[state.dir]),
    ...HEADINGS.map((h) => state.dir === h),
    state.food.x < head.x,
    state.food.x > head.x,
    state.food.y < head.y,
    state.food.y > head.y,
  ];
  return bits.reduce((acc, bit, i) => acc | (bit ? 1 << i : 0), 0);
}

function distanceToFood(state: GameState): number {
  const head = state.snake[0];
  return Math.abs(state.food.x - head.x) + Math.abs(state.food.y - head.y);
}

// +10 for eating, -10 for dying, a small nudge for moving toward or away from the food
export function snakeReward(prev: GameState, next: GameState): number {
  if (next.won) return REWARD_EAT;      // winning is the best outcome, check it before the death branch
  if (!next.alive) return REWARD_DIE;
  if (next.score > prev.score) return REWARD_EAT;
  return distanceToFood(next) < distanceToFood(prev) ? REWARD_CLOSER : REWARD_FARTHER;
}

// Wandering this long without eating counts as a failure (also stops endless loops while training or playing)
export function snakeStepLimit(gridSize: number): number {
  return 2 * gridSize * gridSize;
}

// Greedy move for the UI: the absolute direction the trained snake wants to go in
export function snakePickDirection(table: QTable, state: GameState): Direction {
  return actionToDirection(state.dir, chooseAction(table, snakeFeatures(state), 0));
}

// The env wraps the game state with the "steps since last food" counter used for the stuck limit
export type SnakeEnvState = { game: GameState; sinceFood: number };

export const snakeEnv: Env<SnakeEnvState> = {
  id: "snake",
  // 1 = "danger" bits (wall or body next to the head), 2 = "cramped" bits (flood-fill free space). Bump on any change to snakeFeatures.
  featuresVersion: 2,
  stateCount: STATE_COUNT,
  actionCount: ACTION_COUNT,
  reset(rng, variant) {
    const size = variant ?? MIN_GRID_SIZE + Math.floor(rng() * (MAX_GRID_SIZE - MIN_GRID_SIZE + 1));
    // The game's own random seed comes from the training rng, so a whole training run can be seeded
    return { game: createInitialState(size, Math.floor(rng() * 4294967296)), sinceFood: 0 };
  },
  encode: (state) => snakeFeatures(state.game),
  step(state, action) {
    const next = step(state.game, actionToDirection(state.game.dir, action));
    const sinceFood = next.score > state.game.score ? 0 : state.sinceFood + 1;
    const stuck = sinceFood > snakeStepLimit(next.gridSize);
    return {
      next: { game: next, sinceFood },
      reward: stuck ? REWARD_DIE : snakeReward(state.game, next),
      done: !next.alive || stuck,
    };
  },
  score: (state) => state.game.score,
  evalVariants: [MIN_GRID_SIZE, 12, 20, 30, MAX_GRID_SIZE].map((size) => ({ label: `grid ${size}x${size}`, variant: size })),
};
