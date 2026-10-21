import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseBrain } from "../../../src/lib/ai/brain.ts";
import { chooseAction } from "../../../src/lib/ai/qlearning.ts";
import { encodeMoves, maxMoves } from "../../../src/lib/game/replay.ts";
import { actionToDirection, snakeEnv, snakeFeatures } from "../../../src/lib/game/snake-env.ts";
import type { SnakeEnvState } from "../../../src/lib/game/snake-env.ts";
import { createInitialState } from "../../../src/lib/game/snake.ts";
import type { Direction } from "../../../src/lib/game/snake.ts";
import { seededRng } from "../../../src/lib/rng.ts";
import { learnOnce } from "../../../src/lib/snake-learning/learner.ts";
import type { LearnOptions } from "../../../src/lib/snake-learning/learner.ts";
import { MemorySubmissionStore } from "../../../src/lib/training/submissions.ts";
import type { SubmissionLimits } from "../../../src/lib/training/submissions.ts";

const builtin: unknown = JSON.parse(readFileSync("public/brains/snake.json", "utf8"));
const table = parseBrain(builtin, snakeEnv);
if (!table) throw new Error("the shipped brain must load for these tests");

const LIMITS: SubmissionLimits = { perSource: 1000, global: 10000, maxPending: 10000, windowMs: 3_600_000 };
// Small evaluation keeps the tests fast; the gate logic is the same
const FAST: LearnOptions = { evalVariants: [8], evalSeeds: [1, 2, 3] };
const NOW = new Date("2026-10-21T00:00:00Z");

// Plays one game with the shipped brain and returns the moves a client would submit
function play(gridSize: number, seed: number, noise = 0.1): string {
  const rng = seededRng(seed + 7);
  let state: SnakeEnvState = { game: createInitialState(gridSize, seed), sinceFood: 0 };
  const directions: Direction[] = [];
  while (directions.length < maxMoves(gridSize)) {
    const action = chooseAction(table!, snakeFeatures(state.game), noise, rng);
    directions.push(actionToDirection(state.game.dir, action));
    const { next, done } = snakeEnv.step(state, action);
    if (done) break;
    state = next;
  }
  return encodeMoves(directions);
}

async function submit(store: MemorySubmissionStore, source: string, seed: number, moves = play(10, seed)): Promise<number> {
  const result = await store.addWithQuota({ game: "snake", variant: "10", seed, moves, sourceHash: source }, LIMITS);
  assert.ok(result.ok);
  return result.id;
}

function deps(store: MemorySubmissionStore) {
  return { store, loadBuiltinBrain: () => builtin, now: () => NOW };
}

describe("learnOnce", () => {
  test("with nothing pending, nothing is published", async () => {
    const store = new MemorySubmissionStore();
    const report = await learnOnce(deps(store), FAST);
    assert.equal(report.pending, 0);
    assert.equal(report.published, false);
    assert.equal(await store.getPublished("snake"), null);
  });

  test("valid games produce a published generation", async () => {
    const store = new MemorySubmissionStore();
    for (let i = 0; i < 5; i++) await submit(store, `p${i}`, 1000 + i);
    const report = await learnOnce(deps(store), FAST);
    assert.equal(report.gamesUsed, 5);
    assert.equal(report.base, "builtin");
    assert.equal(report.published, true);
    const published = await store.getPublished("snake");
    assert.ok(published);
    assert.equal(published.featuresVersion, snakeEnv.featuresVersion);
    assert.ok(parseBrain(published.data, snakeEnv));
    assert.deepEqual(await store.listPending("snake", 10), []);
  });

  test("a forged game is rejected with a reason and does not block the others", async () => {
    const store = new MemorySubmissionStore();
    const good = await submit(store, "a", 2000);
    const forged = await submit(store, "b", 2001, play(10, 2001) + "dddd");
    const report = await learnOnce(deps(store), FAST);
    assert.equal(report.gamesUsed, 1);
    assert.equal(report.rejected["moves after the game ended"], 1);
    assert.deepEqual(await store.listPending("snake", 10), []);
    assert.notEqual(good, forged);
    assert.ok(await store.getPublished("snake"));
  });

  test("games over the per-source limit stay pending", async () => {
    const store = new MemorySubmissionStore();
    for (let i = 0; i < 3; i++) await submit(store, "same", 3000 + i);
    const report = await learnOnce(deps(store), { ...FAST, maxGamesPerSource: 2 });
    assert.equal(report.gamesUsed, 2);
    assert.equal(report.deferred, 1);
    assert.equal((await store.listPending("snake", 10)).length, 1);
  });

  test("when the gate refuses, the games are consumed but nothing is published", async () => {
    const store = new MemorySubmissionStore();
    for (let i = 0; i < 5; i++) await submit(store, `p${i}`, 4000 + i);
    // A negative tolerance demands the candidate beat the current brain by a margin it cannot reach with one batch
    const report = await learnOnce(deps(store), { ...FAST, tolerance: -1 });
    assert.equal(report.gamesUsed, 5);
    assert.equal(report.gatePassed, false);
    assert.equal(report.published, false);
    assert.equal(await store.getPublished("snake"), null);
    assert.deepEqual(await store.listPending("snake", 10), []);
  });

  test("a previously published brain is the base of the next run", async () => {
    const store = new MemorySubmissionStore();
    for (let i = 0; i < 3; i++) await submit(store, `p${i}`, 5000 + i);
    await learnOnce(deps(store), FAST);
    const first = await store.getPublished("snake");
    assert.ok(first);

    for (let i = 0; i < 3; i++) await submit(store, `q${i}`, 6000 + i);
    const report = await learnOnce(deps(store), FAST);
    assert.equal(report.base, "published");
    assert.equal(report.baseBrainId, first.brainId);
    const second = await store.getPublished("snake");
    assert.ok(second);
    assert.notEqual(second.brainId, first.brainId);
  });

  test("a published brain with another features version is ignored", async () => {
    const store = new MemorySubmissionStore();
    await submit(store, "a", 7000);
    await store.recordGeneration({
      game: "snake",
      usedIds: [],
      rejected: [],
      brain: { data: builtin, eval: null, featuresVersion: snakeEnv.featuresVersion + 1, episodes: 1 },
    });
    const report = await learnOnce(deps(store), FAST);
    assert.equal(report.base, "builtin");
  });

  test("a published base that is already below the built-in floor cannot be extended", async () => {
    const store = new MemorySubmissionStore();
    // Publish an untrained (all zero) table as the current brain: far below the built-in one
    const weak = { ...(builtin as Record<string, unknown>), q: new Array(snakeEnv.stateCount * snakeEnv.actionCount).fill(0) };
    await store.recordGeneration({
      game: "snake",
      usedIds: [],
      rejected: [],
      brain: { data: weak, eval: null, featuresVersion: snakeEnv.featuresVersion, episodes: 1 },
    });
    const weakId = (await store.getPublished("snake"))?.brainId;
    for (let i = 0; i < 3; i++) await submit(store, `w${i}`, 8000 + i);
    const report = await learnOnce(deps(store), FAST);
    assert.equal(report.base, "published");
    assert.equal(report.gamesUsed, 3);
    assert.equal(report.floorPassed, false);
    assert.equal(report.published, false);
    assert.equal((await store.getPublished("snake"))?.brainId, weakId);
  });

  test("a normal run reports the floor as passed", async () => {
    const store = new MemorySubmissionStore();
    for (let i = 0; i < 3; i++) await submit(store, `n${i}`, 9000 + i);
    const report = await learnOnce(deps(store), FAST);
    assert.equal(report.floorPassed, true);
    assert.equal(report.published, true);
  });
});
