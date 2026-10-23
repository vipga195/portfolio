import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { nextRandom, seededRng } from "../../src/lib/rng.ts";

describe("seededRng", () => {
  test("the same seed gives the same sequence, another seed another one", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const c = seededRng(43);
    const first = Array.from({ length: 5 }, () => a());
    assert.deepEqual(first, Array.from({ length: 5 }, () => b()));
    assert.notDeepEqual(first, Array.from({ length: 5 }, () => c()));
  });

  test("follows nextRandom step by step", () => {
    const rng = seededRng(12345);
    let seed = 12345;
    for (let i = 0; i < 20; i++) {
      const [value, next] = nextRandom(seed);
      seed = next;
      assert.equal(rng(), value);
    }
  });

  test("always stays inside [0, 1)", () => {
    const rng = seededRng(0xffffffff);
    for (let i = 0; i < 5000; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1);
    }
  });

  test("two generators with different seeds do not influence each other", () => {
    const a = seededRng(1);
    const expected = Array.from({ length: 3 }, seededRng(1));
    seededRng(2)();
    assert.deepEqual(Array.from({ length: 3 }, () => a()), expected);
  });
});
