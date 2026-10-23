import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseBrain } from "../../../src/lib/ai/brain.ts";
import type { Transition } from "../../../src/lib/ai/env.ts";
import { chooseAction } from "../../../src/lib/ai/qlearning.ts";
import { decodeMoves, encodeMoves, maxMoves } from "../../../src/lib/game/replay.ts";
import {
  REWARD_DIE,
  REWARD_EAT,
  actionToDirection,
  directionToAction,
  snakeEnv,
  snakeFeatures,
  snakeStepLimit,
} from "../../../src/lib/game/snake-env.ts";
import type { SnakeEnvState } from "../../../src/lib/game/snake-env.ts";
import { snakeTransitionsFromMoves } from "../../../src/lib/game/snake-transitions.ts";
import { createInitialState } from "../../../src/lib/game/snake.ts";
import type { Direction } from "../../../src/lib/game/snake.ts";
import { seededRng } from "../../../src/lib/rng.ts";

const HEADINGS: Direction[] = ["up", "down", "left", "right"];

const table = parseBrain(JSON.parse(readFileSync("public/brains/snake.json", "utf8")), snakeEnv);
if (!table) throw new Error("the shipped brain must load for these tests");

// Plays a game live through snakeEnv.step and records what a client would have submitted plus the "true" transitions
function playLive(gridSize: number, seed: number, noise: number) {
  const rng = seededRng(seed + 7);
  let state: SnakeEnvState = { game: createInitialState(gridSize, seed), sinceFood: 0 };
  const directions: Direction[] = [];
  const transitions: Transition<SnakeEnvState>[] = [];
  while (directions.length < maxMoves(gridSize)) {
    const action = chooseAction(table!, snakeFeatures(state.game), noise, rng);
    directions.push(actionToDirection(state.game.dir, action));
    const { next, reward, done } = snakeEnv.step(state, action);
    transitions.push({ state, action, reward, next, done });
    if (done) break;
    state = next;
  }
  return { moves: encodeMoves(directions), transitions };
}

describe("directionToAction", () => {
  test("is the inverse of actionToDirection for every heading", () => {
    for (const heading of HEADINGS) {
      for (const action of [0, 1, 2]) {
        assert.equal(directionToAction(heading, actionToDirection(heading, action)), action);
      }
    }
  });

  test("a 180-degree reversal counts as going straight", () => {
    assert.equal(directionToAction("up", "down"), 0);
    assert.equal(directionToAction("left", "right"), 0);
  });
});

describe("decodeMoves", () => {
  test("is the inverse of encodeMoves and rejects unknown characters", () => {
    const directions: Direction[] = ["up", "left", "down", "right"];
    assert.deepEqual(decodeMoves(encodeMoves(directions)), directions);
    assert.equal(decodeMoves("udx"), null);
  });
});

describe("snakeTransitionsFromMoves", () => {
  test("rebuilds exactly the transitions recorded while playing live", () => {
    let totalEaten = 0;
    for (const [gridSize, seed, noise] of [[12, 1, 0], [20, 99, 0.1], [8, 5, 0.3], [30, 2024, 0.05], [10, 77, 1]] as const) {
      const live = playLive(gridSize, seed, noise);
      const result = snakeTransitionsFromMoves(gridSize, seed, live.moves);
      assert.ok(result.ok, "a legal game must be accepted");
      assert.deepEqual(result.transitions, live.transitions);
      totalEaten += result.transitions.filter((t) => t.reward === REWARD_EAT).length;
    }
    assert.ok(totalEaten > 10, `the games should include real eating, got ${totalEaten}`);
  });

  test("the last transition of a game that ended by death is terminal with the death reward", () => {
    const live = playLive(10, 3, 1);   // fully random moves: dies quickly
    const result = snakeTransitionsFromMoves(10, 3, live.moves);
    assert.ok(result.ok);
    const last = result.transitions[result.transitions.length - 1];
    assert.equal(last.done, true);
    assert.equal(last.reward, REWARD_DIE);
    assert.equal(result.final.alive, false);
    assert.ok(result.transitions.slice(0, -1).every((t) => !t.done));
  });

  test("a reversal request is learned as the action 'straight'", () => {
    // Initial heading is down; "u" asks for a reversal, so the snake keeps going down
    const result = snakeTransitionsFromMoves(10, 3, "du");
    assert.ok(result.ok);
    assert.equal(result.transitions[0].action, 0);
    assert.equal(result.transitions[1].action, 0);
    assert.equal(result.final.dir, "down");
  });

  test("rejects what replay rejects, with its reason", () => {
    const outOfRange = snakeTransitionsFromMoves(3, 1, "d");
    assert.equal(outOfRange.ok, false);
    const badChar = snakeTransitionsFromMoves(10, 1, "dx");
    assert.equal(badChar.ok, false);
    const afterDeath = snakeTransitionsFromMoves(8, 1, "d".repeat(20));
    assert.equal(afterDeath.ok, false);
    if (!afterDeath.ok) assert.match(afterDeath.reason, /after the game ended/);
  });

  test("stops at the stuck limit: later moves are not learned from", () => {
    const size = 8;
    // Down twice, then circle a free 3x3 ring forever without eating; find a seed whose food is not on the ring
    const moves = "dd" + "rruulldd".repeat(20);
    for (let seed = 1; seed < 500; seed++) {
      const result = snakeTransitionsFromMoves(size, seed, moves);
      if (!result.ok || result.final.score !== 0) continue;
      const limit = snakeStepLimit(size);
      assert.equal(result.transitions.length, limit + 1, "the episode ends on the first step past the limit");
      const last = result.transitions[result.transitions.length - 1];
      assert.equal(last.done, true);
      assert.equal(last.reward, REWARD_DIE);
      assert.equal(last.next.game.alive, true, "stuck is a failure but the snake is still alive");
      return;
    }
    assert.fail("no seed found where the snake circles without eating");
  });
});
