import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { Transition } from "../../../src/lib/ai/env.ts";
import { cloneQTable, ingestTransitions, runPipeline } from "../../../src/lib/ai/ingest.ts";
import type { PipelineOptions, SubmittedGame, TransitionsOutcome } from "../../../src/lib/ai/ingest.ts";
import { createQTable, updateQ } from "../../../src/lib/ai/qlearning.ts";
import { lineEnv, preferring } from "./toy-env.ts";
import type { LineState } from "./toy-env.ts";

// Toy "submitted game": moves is a string of actions, "1" = right and "0" = left, replayed through the toy env
function toTransitions(game: SubmittedGame): TransitionsOutcome<LineState> {
  const transitions: Transition<LineState>[] = [];
  let state: LineState = { pos: 2, steps: 0 };
  for (const char of game.moves) {
    if (char !== "0" && char !== "1") return { ok: false, reason: "unknown move character" };
    const { next, reward, done } = lineEnv.step(state, Number(char));
    transitions.push({ state, action: Number(char), reward, next, done });
    if (done) break;
    state = next;
  }
  return { ok: true, transitions };
}

const OPTIONS: PipelineOptions = {
  alpha: 0.1,
  gamma: 0.9,
  maxGamesPerSource: 2,
  evalVariants: [0],
  evalSeeds: [1, 2, 3, 4, 5],
  tolerance: 0.05,
};

let nextSeed = 1;
function game(source: string, moves: string, seed: number = nextSeed++): SubmittedGame {
  return { source, gridSize: 0, seed, moves };
}

describe("ingestTransitions", () => {
  test("applies exactly the Q-learning update for every transition", () => {
    const outcome = toTransitions(game("a", "11"));
    assert.ok(outcome.ok);
    const { transitions } = outcome;
    assert.equal(transitions.length, 2);

    const viaIngest = createQTable(5, 2);
    ingestTransitions(lineEnv, viaIngest, transitions, 0.1, 0.9);

    const manual = createQTable(5, 2);
    for (const t of transitions) updateQ(manual, t.state.pos, t.action, t.reward, t.next.pos, t.done, 0.1, 0.9);
    assert.deepEqual(viaIngest.values, manual.values);
    assert.ok(viaIngest.values.some((v) => v !== 0));
  });

  test("cloneQTable makes an independent copy", () => {
    const original = preferring(1);
    const copy = cloneQTable(original);
    copy.values[0] = 99;
    assert.equal(original.values[0], 0);
    assert.deepEqual(cloneQTable(original).values, original.values);
  });
});

describe("runPipeline", () => {
  test("never modifies the published table and learns into a copy", () => {
    const current = preferring(1);
    const snapshot = current.values.slice();
    const { candidate, report } = runPipeline(lineEnv, current, [game("a", "11")], toTransitions, OPTIONS);
    assert.deepEqual(current.values, snapshot);
    assert.notDeepEqual(candidate.values, snapshot);
    assert.equal(report.gamesUsed, 1);
    assert.equal(report.transitionsLearned, 2);
  });

  test("publishes a candidate that is as good as the current brain", () => {
    const { report } = runPipeline(lineEnv, preferring(1), [game("a", "11")], toTransitions, OPTIONS);
    assert.equal(report.before.avg, 1);
    assert.equal(report.after.avg, 1);
    assert.equal(report.publish, true);
  });

  test("ignores games beyond the per-source limit and counts them", () => {
    const games = [game("a", "11"), game("a", "11"), game("a", "11"), game("b", "11")];
    const { report } = runPipeline(lineEnv, preferring(1), games, toTransitions, OPTIONS);
    assert.equal(report.gamesUsed, 3);
    assert.equal(report.rejected["source limit"], 1);
  });

  test("rejects a seed that was already used in the batch", () => {
    const games = [game("a", "11", 500), game("b", "11", 500)];
    const { report } = runPipeline(lineEnv, preferring(1), games, toTransitions, OPTIONS);
    assert.equal(report.gamesUsed, 1);
    assert.equal(report.rejected["duplicate seed"], 1);
  });

  test("a rejected game does not use up its seed or its source quota", () => {
    const games = [game("a", "1x", 700), game("a", "11", 700), game("a", "11", 701), game("a", "11", 702)];
    const { report } = runPipeline(lineEnv, preferring(1), games, toTransitions, OPTIONS);
    assert.equal(report.rejected["unknown move character"], 1);
    assert.equal(report.gamesUsed, 2, "the quota of 2 per source is spent only on accepted games");
    assert.equal(report.rejected["source limit"], 1);
  });

  test("with nothing to learn from, the candidate equals the current brain and is not published", () => {
    const current = preferring(1);
    const { candidate, report } = runPipeline(lineEnv, current, [game("a", "x")], toTransitions, OPTIONS);
    assert.deepEqual(candidate.values, current.values);
    assert.equal(report.gamesUsed, 0);
    assert.equal(report.publish, false);
  });

  test("a poisoned batch that makes the brain worse is not published", () => {
    // Fabricated transitions claim that going right from cell 3 is terrible: this is what a buggy or hostile source
    // could do if its data were not recomputed by the server. The gate must catch the damage.
    const poison = (): TransitionsOutcome<LineState> => ({
      ok: true,
      transitions: Array.from({ length: 200 }, () => ({
        state: { pos: 3, steps: 0 },
        action: 1,
        reward: -100,
        next: { pos: 4, steps: 1 },
        done: true,
      })),
    });
    const { report } = runPipeline(lineEnv, preferring(1), [game("evil", "11")], poison, OPTIONS);
    assert.equal(report.before.avg, 1);
    assert.equal(report.after.avg, 0);
    assert.equal(report.publish, false);
  });

  test("refuses to run without evaluation seeds", () => {
    assert.throws(() => runPipeline(lineEnv, preferring(1), [], toTransitions, { ...OPTIONS, evalSeeds: [] }), /evalSeeds/);
  });
});
