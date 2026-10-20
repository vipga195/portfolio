// Snake adapter for the DQN code in src/lib/ai. Reuses snakeEnv for reset/step/score so rewards and the stuck limit
// stay identical; only the observation differs: raw egocentric input, no hand-made features.
import { argmax } from "../ai/dqn.ts";
import type { DenseEnv } from "../ai/dqn.ts";
import { forward } from "../ai/nn.ts";
import type { Mlp } from "../ai/nn.ts";
import { actionToDirection, isCramped, occupiedCells, snakeEnv } from "./snake-env.ts";
import type { SnakeEnvState } from "./snake-env.ts";
import { VECTORS, isOutOfBounds } from "./snake.ts";
import type { Direction, GameState } from "./snake.ts";

const WINDOW_RADIUS = 3;
const WINDOW_SIDE = 2 * WINDOW_RADIUS + 1;
const WINDOW_CELLS = WINDOW_SIDE * WINDOW_SIDE;
// 7x7 window + food (forward, right) + 4 food-side bits + snake length + 3 cramped bits
export const SNAKE_OBSERVATION_SIZE = WINDOW_CELLS + 2 + 4 + 1 + 3;

// Observation of one game, in the snake's own frame: "forward" is always up in the window.
// Nothing here depends on the grid size or the absolute heading, so one network works on every grid size.
export function snakeObservation(game: GameState): Float32Array {
  const { snake, food, dir, gridSize } = game;
  const head = snake[0];
  const f = VECTORS[dir];
  const r = VECTORS[actionToDirection(dir, 2)];
  const obs = new Float32Array(SNAKE_OBSERVATION_SIZE);

  // Window row i = i-th cell ahead of the head counted from the top (3 ahead ... 3 behind), column j = left to right
  for (let i = 0; i < WINDOW_SIDE; i++) {
    const ahead = WINDOW_RADIUS - i;
    for (let j = 0; j < WINDOW_SIDE; j++) {
      const right = j - WINDOW_RADIUS;
      const cell = { x: head.x + f.x * ahead + r.x * right, y: head.y + f.y * ahead + r.y * right };
      if (isOutOfBounds(cell, gridSize)) obs[i * WINDOW_SIDE + j] = 1;
    }
  }
  // Body segments (tail included: the game treats all of them as obstacles). Index 0 is the head, left as 0.
  for (let k = 1; k < snake.length; k++) {
    const dx = snake[k].x - head.x;
    const dy = snake[k].y - head.y;
    const ahead = dx * f.x + dy * f.y;
    const right = dx * r.x + dy * r.y;
    if (Math.abs(ahead) <= WINDOW_RADIUS && Math.abs(right) <= WINDOW_RADIUS) {
      obs[(WINDOW_RADIUS - ahead) * WINDOW_SIDE + right + WINDOW_RADIUS] = 1;
    }
  }

  const fx = food.x - head.x;
  const fy = food.y - head.y;
  const foodAhead = fx * f.x + fy * f.y;
  const foodRight = fx * r.x + fy * r.y;
  let o = WINDOW_CELLS;
  obs[o++] = foodAhead / gridSize;
  obs[o++] = foodRight / gridSize;
  obs[o++] = foodAhead > 0 ? 1 : 0;
  obs[o++] = foodAhead < 0 ? 1 : 0;
  obs[o++] = foodRight < 0 ? 1 : 0;
  obs[o++] = foodRight > 0 ? 1 : 0;
  obs[o++] = snake.length / (gridSize * gridSize);
  // Hand-built flood-fill feature shared with the Q-table: next cell is a wall, body, or a pocket smaller than the snake
  const occupied = occupiedCells(game);
  for (const action of [0, 1, 2]) obs[o++] = isCramped(game, occupied, actionToDirection(dir, action)) ? 1 : 0;
  return obs;
}

export const snakeDqnEnv: DenseEnv<SnakeEnvState> = {
  id: "snake-dqn",
  // Bump on any change to snakeObservation
  featuresVersion: 3,
  actionCount: snakeEnv.actionCount,
  observationSize: SNAKE_OBSERVATION_SIZE,
  reset: (rng, variant) => snakeEnv.reset(rng, variant),
  observe: (state) => snakeObservation(state.game),
  step: (state, action) => snakeEnv.step(state, action),
  score: (state) => snakeEnv.score(state),
  evalVariants: snakeEnv.evalVariants,
};

// Greedy move for the UI: the absolute direction the trained snake wants to go in
export function snakeDqnPickDirection(net: Mlp, state: GameState): Direction {
  return actionToDirection(state.dir, argmax(forward(net, snakeObservation(state))));
}
