import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createInitialState, step } from "../../../src/lib/game/snake.ts";
import type { Direction, GameState } from "../../../src/lib/game/snake.ts";
import { maxMoves, replay } from "../../../src/lib/game/replay.ts";
import {
  encodeRecordedMoves,
  loadPublishedBrain,
  recordMove,
  requestSession,
  submitMoves,
} from "../../../src/lib/snake-learning/client.ts";
import type { FetchLike } from "../../../src/lib/snake-learning/client.ts";

const reply = (status: number, body: unknown): FetchLike => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
const failing: FetchLike = async () => { throw new TypeError("network down"); };
// Never answers until aborted
const hanging: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

describe("requestSession", () => {
  test("returns token and seed on 200 and posts the grid size", async () => {
    let seen: { url: string; body: string } | null = null;
    const f: FetchLike = async (url, init) => {
      seen = { url: String(url), body: String(init?.body) };
      return new Response(JSON.stringify({ token: "t.s", gridSize: 20, seed: 42 }), { status: 200 });
    };
    assert.deepEqual(await requestSession(20, f), { token: "t.s", seed: 42 });
    assert.deepEqual(seen, { url: "/api/learning/session", body: '{"gridSize":20}' });
  });
  test("null on non-200", async () => {
    for (const status of [404, 429, 500]) assert.equal(await requestSession(20, reply(status, { error: "x" })), null);
  });
  test("null on network error", async () => assert.equal(await requestSession(20, failing), null));
  test("null on timeout", async () => assert.equal(await requestSession(20, hanging, 30), null));
  test("null on bad JSON or wrong shape", async () => {
    assert.equal(await requestSession(20, reply(200, "not json")), null);
    assert.equal(await requestSession(20, reply(200, { token: "", seed: 1 })), null);
    assert.equal(await requestSession(20, reply(200, { token: "t", seed: -1 })), null);
    assert.equal(await requestSession(20, reply(200, { token: "t", seed: "7" })), null);
    assert.equal(await requestSession(20, reply(200, [1])), null);
  });
});

describe("submitMoves", () => {
  test("true on 202 and sends token + moves", async () => {
    let body = "";
    const f: FetchLike = async (_u, init) => { body = String(init?.body); return new Response("{}", { status: 202 }); };
    assert.equal(await submitMoves("tok", "uudd", f), true);
    assert.deepEqual(JSON.parse(body), { token: "tok", moves: "uudd" });
  });
  test("false on 409/429/404, network error and timeout; never throws", async () => {
    for (const status of [404, 409, 429]) assert.equal(await submitMoves("t", "u", reply(status, {})), false);
    assert.equal(await submitMoves("t", "u", failing), false);
    assert.equal(await submitMoves("t", "u", hanging, 30), false);
  });
});

describe("loadPublishedBrain", () => {
  test("returns the brain field on 200 and asks for the features version", async () => {
    let url = "";
    const f: FetchLike = async (u) => { url = String(u); return new Response(JSON.stringify({ brain: { a: 1 }, featuresVersion: 2 }), { status: 200 }); };
    assert.deepEqual(await loadPublishedBrain(2, f), { a: 1 });
    assert.equal(url, "/api/learning/brain?featuresVersion=2");
  });
  test("null on 404, network error, timeout, bad JSON and missing brain", async () => {
    assert.equal(await loadPublishedBrain(2, reply(404, { error: "no_published_brain" })), null);
    assert.equal(await loadPublishedBrain(2, failing), null);
    assert.equal(await loadPublishedBrain(2, hanging, 30), null);
    assert.equal(await loadPublishedBrain(2, reply(200, "oops")), null);
    assert.equal(await loadPublishedBrain(2, reply(200, { featuresVersion: 2 })), null);
  });
});

describe("recordMove", () => {
  test("appends while alive, refuses after death and past the cap", () => {
    const state = createInitialState(8, 1);
    const moves: Direction[] = [];
    assert.equal(recordMove(moves, "down", state), true);
    assert.deepEqual(moves, ["down"]);
    assert.equal(recordMove(moves, "left", { ...state, alive: false }), false);
    assert.equal(moves.length, 1);
    const full: Direction[] = new Array<Direction>(maxMoves(8)).fill("down");
    assert.equal(recordMove(full, "down", state), false);
    assert.equal(full.length, maxMoves(8));
  });
});

// Mirrors the component's tick loop: record the requested direction right before `step`, then step
function play(gridSize: number, seed: number, pick: (tick: number, s: GameState) => Direction): { final: GameState; moves: Direction[] } {
  let curr = createInitialState(gridSize, seed);
  const moves: Direction[] = [];
  let dir: Direction = curr.dir;
  for (let tick = 0; tick < maxMoves(gridSize) && curr.alive; tick++) {
    dir = pick(tick, curr);
    assert.equal(recordMove(moves, dir, curr), true);
    curr = step(curr, dir);
  }
  return { final: curr, moves };
}

describe("recorded moves replay to the same state", () => {
  const dirs: Direction[] = ["up", "down", "left", "right"];
  for (const [grid, seed] of [[8, 1], [12, 99], [20, 123456789], [20, 4294967295]] as const) {
    test(`grid ${grid} seed ${seed}: pseudo-random human, includes reversals`, () => {
      let x = seed || 1;
      const rand = (): number => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x; };
      const { final, moves } = play(grid, seed, () => dirs[rand() % 4]);
      assert.equal(final.alive, false);
      const result = replay(grid, seed, encodeRecordedMoves(moves));
      assert.equal(result.ok, true);
      if (result.ok) assert.deepEqual(result.final, final);
    });
  }
  test("game that eats food (greedy toward the food) replays identically", () => {
    const { final, moves } = play(12, 7, (_t, s) => {
      const h = s.snake[0];
      if (h.x < s.food.x) return "right";
      if (h.x > s.food.x) return "left";
      return h.y < s.food.y ? "down" : "up";
    });
    assert.ok(final.score > 0);
    const result = replay(12, 7, encodeRecordedMoves(moves));
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.final, final);
  });
});
