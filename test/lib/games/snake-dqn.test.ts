import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createMlp } from "../../../src/lib/ai/nn.ts";
import { SNAKE_OBSERVATION_SIZE, snakeDqnEnv, snakeDqnPickDirection, snakeObservation } from "../../../src/lib/game/snake-dqn.ts";
import { createInitialState } from "../../../src/lib/game/snake.ts";
import type { Direction, GameState, Point } from "../../../src/lib/game/snake.ts";

const WINDOW = 49;
const FWD = WINDOW;
const RGT = WINDOW + 1;
const BITS = WINDOW + 2;   // ahead, behind, left, right
const LEN = WINDOW + 6;
const CRAMPED = WINDOW + 7;   // forward, left, right

function makeState(overrides: Partial<GameState>): GameState {
  return { ...createInitialState(10), ...overrides };
}

// Window cell `ahead` cells in front of the head and `right` cells to its right
function cell(obs: Float32Array, ahead: number, right: number): number {
  return obs[(3 - ahead) * 7 + right + 3];
}

describe("snakeObservation", () => {
  test("has the declared length", () => {
    assert.equal(snakeObservation(createInitialState(12)).length, SNAKE_OBSERVATION_SIZE);
    assert.equal(snakeDqnEnv.observationSize, SNAKE_OBSERVATION_SIZE);
  });

  test("flags walls and body cells in the heading frame", () => {
    // Head in the top-left corner heading up: everything ahead and to the left is wall
    const game = makeState({
      snake: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      dir: "up",
      food: { x: 5, y: 5 },
    });
    const obs = snakeObservation(game);
    assert.equal(cell(obs, 1, 0), 1);    // wall ahead
    assert.equal(cell(obs, 0, -1), 1);   // wall left
    assert.equal(cell(obs, 0, 1), 1);    // body to the right
    assert.equal(cell(obs, 0, 2), 1);    // tail, two cells right
    assert.equal(cell(obs, 0, 3), 0);    // free cell
    assert.equal(cell(obs, -1, 1), 0);   // free cell behind-right
    assert.equal(cell(obs, 0, 0), 0);    // head cell itself
  });

  test("is identical for the same layout rotated by 90 degrees", () => {
    const size = 10;
    const clockwise: Record<Direction, Direction> = { up: "right", right: "down", down: "left", left: "up" };
    const rotate = (p: Point): Point => ({ x: size - 1 - p.y, y: p.x });
    const game = makeState({
      gridSize: size,
      snake: [{ x: 4, y: 1 }, { x: 4, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }],
      dir: "up",
      food: { x: 7, y: 6 },
    });
    let current = game;
    const reference = snakeObservation(game);
    for (let turn = 0; turn < 4; turn++) {
      current = { ...current, snake: current.snake.map(rotate), food: rotate(current.food), dir: clockwise[current.dir] };
      assert.deepEqual(snakeObservation(current), reference);
    }
  });

  test("food components are right for each heading", () => {
    // Food 3 cells to the east and 2 to the south of the head (in the world)
    const head = { x: 4, y: 4 };
    const food = { x: 7, y: 6 };
    const snake = [head, { x: 4, y: 3 }, { x: 4, y: 2 }];
    // [heading, expected forward, expected right]
    const cases: [Direction, number, number][] = [
      ["right", 3, 2],
      ["down", 2, -3],
      ["left", -3, -2],
      ["up", -2, 3],
    ];
    for (const [dir, ahead, right] of cases) {
      const obs = snakeObservation(makeState({ snake, food, dir }));
      assert.equal(obs[FWD], Math.fround(ahead / 10), dir);
      assert.equal(obs[RGT], Math.fround(right / 10), dir);
      assert.deepEqual(
        Array.from(obs.subarray(BITS, BITS + 4)),
        [ahead > 0 ? 1 : 0, ahead < 0 ? 1 : 0, right < 0 ? 1 : 0, right > 0 ? 1 : 0],
        dir,
      );
    }
  });

  test("encodes snake length relative to the grid area", () => {
    const obs = snakeObservation(makeState({ gridSize: 10 }));
    assert.ok(Math.abs(obs[LEN] - 3 / 100) < 1e-6);
  });
});

describe("cramped bits", () => {
  const cramped = (game: GameState): number[] => Array.from(snakeObservation(game).subarray(CRAMPED, CRAMPED + 3));

  test("are 0 in open space", () => {
    const game = makeState({ snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }], dir: "up", food: { x: 1, y: 1 } });
    assert.deepEqual(cramped(game), [0, 0, 0]);
  });

  test("flag a wall ahead only", () => {
    const game = makeState({ snake: [{ x: 5, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 2 }], dir: "up", food: { x: 1, y: 5 } });
    assert.deepEqual(cramped(game), [1, 0, 0]);
  });

  test("flag a free pocket smaller than the snake", () => {
    // Heading left into the single free corner cell (0,0), walled in by the body
    const game = makeState({ snake: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], dir: "left", food: { x: 5, y: 5 } });
    assert.equal(cell(snakeObservation(game), 1, 0), 0);   // the pocket cell itself is free in the window
    assert.equal(cramped(game)[0], 1);
  });
});

describe("snakeDqnEnv / snakeDqnPickDirection", () => {
  test("shares reward and stuck logic with snakeEnv", () => {
    const rng = (): number => 0.5;
    const state = snakeDqnEnv.reset(rng, 10);
    assert.equal(state.game.gridSize, 10);
    const { next, done } = snakeDqnEnv.step(state, 0);
    assert.equal(done, false);
    assert.equal(snakeDqnEnv.observe(next).length, SNAKE_OBSERVATION_SIZE);
  });

  test("returns a legal absolute direction (never a reversal)", () => {
    const net = createMlp([SNAKE_OBSERVATION_SIZE, 8, 3], () => 0.3);
    const game = createInitialState(10, 1);
    assert.notEqual(snakeDqnPickDirection(net, game), "up");   // snake heads down at the start
  });
});
