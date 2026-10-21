import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MAX_GRID_SIZE, MIN_GRID_SIZE } from "../../../src/lib/game/snake.ts";
import { maxMoves } from "../../../src/lib/game/replay.ts";
import {
  MAX_SUBMISSION_BYTES,
  MAX_TOKEN_CHARS,
  parseSubmission,
  validateMovesShape,
} from "../../../src/lib/snake-learning/submission.ts";

describe("parseSubmission", () => {
  test("accepts a well-formed submission and returns only the two fields", () => {
    assert.deepEqual(parseSubmission({ token: "abc.def", moves: "uddlr", extra: "ignored" }), {
      ok: true,
      value: { token: "abc.def", moves: "uddlr" },
    });
  });

  test("rejects bodies that are not a plain object", () => {
    for (const body of [null, undefined, 42, "text", true, [], [{ token: "t", moves: "u" }]]) {
      assert.equal(parseSubmission(body).ok, false, `should reject ${JSON.stringify(body)}`);
    }
  });

  test("rejects a missing, non-string, empty or oversized token", () => {
    for (const token of [undefined, null, 5, {}, [], "", "x".repeat(MAX_TOKEN_CHARS + 1)]) {
      assert.deepEqual(parseSubmission({ token, moves: "u" }), { ok: false, reason: "invalid token" });
    }
    assert.equal(parseSubmission({ token: "x".repeat(MAX_TOKEN_CHARS), moves: "u" }).ok, true);
  });

  test("rejects missing, non-string, empty, oversized or illegal moves", () => {
    for (const moves of [undefined, null, 7, ["u"], "", "udx", "UD", "u d", "u\n", "up", "u".repeat(maxMoves(MAX_GRID_SIZE) + 1)]) {
      assert.deepEqual(parseSubmission({ token: "t", moves }), { ok: false, reason: "invalid moves" });
    }
    assert.equal(parseSubmission({ token: "t", moves: "u".repeat(maxMoves(MAX_GRID_SIZE)) }).ok, true);
  });

  test("the body size limit fits the largest legal submission and nothing much bigger", () => {
    const largest = JSON.stringify({ token: "x".repeat(MAX_TOKEN_CHARS), moves: "u".repeat(maxMoves(MAX_GRID_SIZE)) });
    assert.ok(largest.length <= MAX_SUBMISSION_BYTES, `${largest.length} > ${MAX_SUBMISSION_BYTES}`);
    assert.ok(MAX_SUBMISSION_BYTES < largest.length + 200);
  });
});

describe("validateMovesShape", () => {
  test("the length limit depends on the grid size", () => {
    assert.equal(validateMovesShape("u".repeat(maxMoves(MIN_GRID_SIZE)), MIN_GRID_SIZE).ok, true);
    assert.deepEqual(validateMovesShape("u".repeat(maxMoves(MIN_GRID_SIZE) + 1), MIN_GRID_SIZE), {
      ok: false,
      reason: "invalid number of moves",
    });
    // The same length is fine on a bigger grid
    assert.equal(validateMovesShape("u".repeat(maxMoves(MIN_GRID_SIZE) + 1), MAX_GRID_SIZE).ok, true);
  });

  test("rejects empty and illegal characters", () => {
    assert.equal(validateMovesShape("", 10).ok, false);
    assert.deepEqual(validateMovesShape("udq", 10), { ok: false, reason: "invalid moves" });
  });
});
