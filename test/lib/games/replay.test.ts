import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { encodeMoves, maxMoves, replay } from "../../../src/lib/game/replay.ts";
import { chooseAction } from "../../../src/lib/ai/qlearning.ts";
import { parseBrain } from "../../../src/lib/ai/brain.ts";
import { actionToDirection, snakeEnv, snakeFeatures } from "../../../src/lib/game/snake-env.ts";
import { MAX_GRID_SIZE, MIN_GRID_SIZE, createInitialState, step } from "../../../src/lib/game/snake.ts";
import type { Direction } from "../../../src/lib/game/snake.ts";

import { readFileSync } from "node:fs";

// A deterministic "player": mostly goes down, sometimes turns, so the game ends by hitting a wall
function scriptedDirections(count: number): Direction[] {
  const pattern: Direction[] = ["down", "down", "right", "down", "left", "down", "down", "right"];
  return Array.from({ length: count }, (_, i) => pattern[i % pattern.length]);
}

// Plays live with `step`, recording what was requested on every tick, until the game ends
function playLive(gridSize: number, seed: number, pick: (s: ReturnType<typeof createInitialState>) => Direction) {
  let state = createInitialState(gridSize, seed);
  const directions: Direction[] = [];
  while (state.alive && directions.length < maxMoves(gridSize)) {
    const d = pick(state);
    directions.push(d);
    state = step(state, d);
  }
  return { state, directions };
}

describe("replay", () => {
  test("rebuilds exactly the game that was played live", () => {
    for (const seed of [1, 42, 2024, 4294967295]) {
      let i = 0;
      const live = playLive(12, seed, () => scriptedDirections(500)[i++]);
      const result = replay(12, seed, encodeMoves(live.directions));
      assert.ok(result.ok, "replay should accept a legal game");
      assert.deepEqual(result.final, live.state);
      assert.equal(result.states.length, live.directions.length + 1);
    }
  });

  test("rebuilds a long game with many foods eaten by the trained AI", () => {
    const table = parseBrain(JSON.parse(readFileSync("public/brains/snake.json", "utf8")), snakeEnv);
    assert.ok(table, "the shipped brain must load");
    const live = playLive(20, 31337, (s) => actionToDirection(s.dir, chooseAction(table, snakeFeatures(s), 0)));
    assert.ok(live.state.score >= 10, `AI should eat a lot, got ${live.state.score}`);
    const result = replay(20, 31337, encodeMoves(live.directions));
    assert.ok(result.ok);
    assert.deepEqual(result.final, live.state);
    assert.equal(result.final.score, live.state.score);
  });

  test("a different seed gives a different game for the same moves", () => {
    let i = 0;
    const live = playLive(10, 5, () => scriptedDirections(500)[i++]);
    const moves = encodeMoves(live.directions);
    const a = replay(10, 5, moves);
    const b = replay(10, 6, moves);
    assert.ok(a.ok && b.ok);
    assert.notDeepEqual(a.final.food, b.final.food);
  });

  test("states[0] is the initial state and the last state is final", () => {
    const result = replay(10, 3, encodeMoves(["down", "down"]));
    assert.ok(result.ok);
    assert.deepEqual(result.states[0], createInitialState(10, 3));
    assert.equal(result.states[result.states.length - 1], result.final);
  });

  test("a 180-degree reversal request is accepted and the snake keeps going straight", () => {
    const result = replay(10, 3, encodeMoves(["down", "up"]));
    assert.ok(result.ok);
    assert.equal(result.final.dir, "down");
  });

  test("a game that ended is accepted, but one extra move after it is rejected", () => {
    const size = MIN_GRID_SIZE;
    // The head starts at y = size / 2 = 4 heading down, so the 4th "d" runs into the wall
    const result = replay(size, 1, "dddd");
    assert.ok(result.ok);
    assert.equal(result.final.alive, false);
    assert.equal(replay(size, 1, "ddddd").ok, false);
  });
});

describe("replay rejects bad input", () => {
  const ok = encodeMoves(["down", "down"]);

  test("grid size out of range or not an integer", () => {
    assert.equal(replay(MIN_GRID_SIZE - 1, 1, ok).ok, false);
    assert.equal(replay(MAX_GRID_SIZE + 1, 1, ok).ok, false);
    assert.equal(replay(10.5, 1, ok).ok, false);
    assert.equal(replay(Number.NaN, 1, ok).ok, false);
  });

  test("seed that is not an unsigned 32-bit integer", () => {
    assert.equal(replay(10, -1, ok).ok, false);
    assert.equal(replay(10, 4294967296, ok).ok, false);
    assert.equal(replay(10, 1.5, ok).ok, false);
    assert.equal(replay(10, Number.NaN, ok).ok, false);
  });

  test("empty, too long, or not a string", () => {
    assert.equal(replay(10, 1, "").ok, false);
    assert.equal(replay(10, 1, "d".repeat(maxMoves(10) + 1)).ok, false);
    assert.equal(replay(10, 1, 123 as unknown as string).ok, false);   // a client can send any JSON
  });

  test("unknown move characters", () => {
    assert.equal(replay(10, 1, "ddx").ok, false);
    assert.equal(replay(10, 1, "DD").ok, false);
    assert.equal(replay(10, 1, "d d").ok, false);
  });

  test("moves after the game has already ended", () => {
    const afterDeath = replay(8, 1, "d".repeat(20));   // dies on the 4th move, 16 more follow
    assert.equal(afterDeath.ok, false);
    if (!afterDeath.ok) assert.match(afterDeath.reason, /after the game ended/);
  });
});
