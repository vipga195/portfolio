import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  REWARD_DIE,
  REWARD_EAT,
  actionToDirection,
  snakeEnv,
  snakeFeatures,
  snakeReward,
  snakeStepLimit,
} from "../../../src/lib/game/snake-env.ts";
import { MAX_GRID_SIZE, MIN_GRID_SIZE, createInitialState, step } from "../../../src/lib/game/snake.ts";
import type { GameState, Point } from "../../../src/lib/game/snake.ts";

function makeState(overrides: Partial<GameState> = {}): GameState {
  return { ...createInitialState(10), food: { x: 0, y: 0 }, ...overrides };
}

describe("actionToDirection", () => {
  test("maps relative turns to absolute directions", () => {
    assert.equal(actionToDirection("up", 0), "up");
    assert.equal(actionToDirection("up", 1), "left");
    assert.equal(actionToDirection("up", 2), "right");
    assert.equal(actionToDirection("down", 1), "right");
    assert.equal(actionToDirection("left", 1), "down");
    assert.equal(actionToDirection("right", 2), "down");
  });
});

describe("snakeFeatures", () => {
  test("stays inside [0, stateCount)", () => {
    const f = snakeFeatures(makeState());
    assert.ok(Number.isInteger(f) && f >= 0 && f < snakeEnv.stateCount);
  });

  test("flags danger straight ahead next to a wall", () => {
    const s = makeState({ snake: [{ x: 5, y: 9 }, { x: 5, y: 8 }], dir: "down" });
    assert.equal(snakeFeatures(s) & 1, 1);
  });

  test("flags danger on the left when the body is there", () => {
    const s = makeState({ snake: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }], dir: "up" });
    assert.equal((snakeFeatures(s) >> 1) & 1, 1);
  });

  test("flags a free cell that leads into a pocket smaller than the snake", () => {
    // Heading up. The cell on the left (4,5) is empty but walled in by the body: 1 free cell < length 7
    const snake: Point[] = [
      { x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 5 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ];
    const f = snakeFeatures(makeState({ snake, dir: "up" }));
    assert.equal(f & 1, 0, "open space straight ahead");
    assert.equal((f >> 1) & 1, 1, "pocket on the left");
    assert.equal((f >> 2) & 1, 0, "open space on the right");
  });

  test("a big enough open area is not flagged even when it is a dead end for a short snake", () => {
    // Corner of the grid, heading left: the only free cells lie ahead and are plentiful
    const s = makeState({ snake: [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }], dir: "left" });
    assert.equal(snakeFeatures(s) & 1, 0);
  });

  test("no danger bits in open space", () => {
    const s = makeState({ snake: [{ x: 5, y: 5 }, { x: 5, y: 4 }], dir: "down" });
    assert.equal(snakeFeatures(s) & 0b111, 0);
  });

  test("is the same on a bigger grid for the same local picture", () => {
    const small = makeState({ snake: [{ x: 5, y: 5 }, { x: 5, y: 4 }], dir: "down", food: { x: 7, y: 8 } });
    assert.equal(snakeFeatures(small), snakeFeatures({ ...small, gridSize: 30 }));
  });
});

describe("snakeReward", () => {
  test("rewards eating and punishes dying", () => {
    const s = makeState({ food: { x: 5, y: 6 }, snake: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], dir: "down" });
    assert.equal(snakeReward(s, step(s, "down")), REWARD_EAT);
    const wall = makeState({ snake: [{ x: 5, y: 9 }, { x: 5, y: 8 }], dir: "down" });
    assert.equal(snakeReward(wall, step(wall, "down")), REWARD_DIE);
  });

  test("moving closer to the food beats moving away", () => {
    const s = makeState({ food: { x: 5, y: 8 }, snake: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], dir: "down" });
    assert.ok(snakeReward(s, step(s, "down")) > snakeReward(s, step(s, "left")));
  });
});

describe("snakeEnv", () => {
  test("declares the features version the shipped brain was trained with", () => {
    assert.equal(snakeEnv.featuresVersion, 2);
  });

  test("reset uses the requested grid size, or a random size inside the allowed range", () => {
    assert.equal(snakeEnv.reset(Math.random, 12).game.gridSize, 12);
    for (let i = 0; i < 50; i++) {
      const size = snakeEnv.reset(Math.random).game.gridSize;
      assert.ok(size >= MIN_GRID_SIZE && size <= MAX_GRID_SIZE);
    }
  });

  test("step ends the episode on death", () => {
    const state = { game: makeState({ snake: [{ x: 5, y: 9 }, { x: 5, y: 8 }], dir: "down" }), sinceFood: 0 };
    const result = snakeEnv.step(state, 0);
    assert.equal(result.done, true);
    assert.equal(result.reward, REWARD_DIE);
  });

  test("step ends the episode as a failure when the snake is stuck too long", () => {
    const game = makeState({ snake: [{ x: 5, y: 5 }, { x: 5, y: 4 }], dir: "down" });
    const result = snakeEnv.step({ game, sinceFood: snakeStepLimit(game.gridSize) }, 0);
    assert.equal(result.done, true);
    assert.equal(result.reward, REWARD_DIE);
  });

  test("every episode with random actions terminates", () => {
    for (let i = 0; i < 20; i++) {
      let state = snakeEnv.reset(Math.random, MIN_GRID_SIZE);
      let steps = 0;
      for (;;) {
        const { next, done } = snakeEnv.step(state, Math.floor(Math.random() * snakeEnv.actionCount));
        state = next;
        if (done) break;
        assert.ok(++steps < 100000, "episode did not terminate");
      }
    }
  });
});
