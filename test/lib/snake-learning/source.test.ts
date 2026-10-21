import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { sourceHash } from "../../../src/lib/snake-learning/source.ts";

// Fake secrets: these tests never read a real one
const SECRET = "test-secret-for-unit-tests-only-0123456789";
const OTHER_SECRET = "another-test-secret-for-unit-tests-9876543210";

describe("sourceHash", () => {
  test("is stable for the same IP and secret", () => {
    assert.equal(sourceHash("203.0.113.7", SECRET), sourceHash("203.0.113.7", SECRET));
  });

  test("differs for another IP or another secret", () => {
    assert.notEqual(sourceHash("203.0.113.7", SECRET), sourceHash("203.0.113.8", SECRET));
    assert.notEqual(sourceHash("203.0.113.7", SECRET), sourceHash("203.0.113.7", OTHER_SECRET));
  });

  test("is 16 hex characters and does not contain the IP", () => {
    const hash = sourceHash("203.0.113.7", SECRET);
    assert.match(hash, /^[0-9a-f]{16}$/);
    assert.ok(!hash.includes("203"));
  });

  test("a weak secret is a configuration error", () => {
    assert.throws(() => sourceHash("203.0.113.7", "short"));
  });
});
