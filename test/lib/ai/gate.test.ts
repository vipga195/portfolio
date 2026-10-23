import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { evaluateSeeded, shouldPublish } from "../../../src/lib/ai/gate.ts";
import type { EvalSummary } from "../../../src/lib/ai/gate.ts";
import { lineEnv, preferring } from "./toy-env.ts";

const SEEDS = [1, 2, 3, 4, 5];

describe("evaluateSeeded", () => {
  test("measures what a brain does, per variant and overall", () => {
    const good = evaluateSeeded(lineEnv, preferring(1), [0], SEEDS);
    const bad = evaluateSeeded(lineEnv, preferring(0), [0], SEEDS);
    assert.equal(good.avg, 1);
    assert.equal(good.perVariant[0], 1);
    assert.equal(bad.avg, 0);
  });

  test("is deterministic: the same inputs always give the same summary", () => {
    assert.deepEqual(evaluateSeeded(lineEnv, preferring(1), [0], SEEDS), evaluateSeeded(lineEnv, preferring(1), [0], SEEDS));
  });

  test("an empty seed list gives zeros instead of NaN", () => {
    assert.deepEqual(evaluateSeeded(lineEnv, preferring(1), [0], []), { avg: 0, perVariant: { 0: 0 } });
  });
});

describe("shouldPublish", () => {
  const current: EvalSummary = { avg: 100, perVariant: { 8: 20, 20: 100, 40: 180 } };

  test("accepts an equal or better candidate", () => {
    assert.equal(shouldPublish(current, current, 0.05), true);
    assert.equal(shouldPublish({ avg: 120, perVariant: { 8: 25, 20: 120, 40: 215 } }, current, 0.05), true);
  });

  test("accepts a small drop inside the tolerance", () => {
    assert.equal(shouldPublish({ avg: 97, perVariant: { 8: 19, 20: 97, 40: 175 } }, current, 0.05), true);
  });

  test("rejects an overall drop beyond the tolerance", () => {
    assert.equal(shouldPublish({ avg: 90, perVariant: { 8: 18, 20: 90, 40: 162 } }, current, 0.05), false);
  });

  test("rejects a brain that collapses on one variant even when the average looks fine", () => {
    // Average 101 (fine) but grid 8 fell from 20 to 10, more than twice the tolerance
    assert.equal(shouldPublish({ avg: 101, perVariant: { 8: 10, 20: 110, 40: 190 } }, current, 0.05), false);
  });

  test("rejects a candidate that was not measured on a variant the current brain was", () => {
    assert.equal(shouldPublish({ avg: 100, perVariant: { 8: 20, 20: 100 } }, current, 0.05), false);
  });
});
