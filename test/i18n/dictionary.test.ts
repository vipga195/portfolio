import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DICTIONARIES } from "../../src/i18n/dictionary.ts";

// Flattens nested objects to "a.b.c" paths; functions are leaves
function leaves(value: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) for (const [path, leaf] of leaves(child, prefix ? `${prefix}.${key}` : key)) out.set(path, leaf);
  } else {
    out.set(prefix, value);
  }
  return out;
}

describe("trainingLab dictionary", () => {
  const en = leaves(DICTIONARIES.en.trainingLab);

  it("en, ja and vi have the same keys", () => {
    for (const lang of ["ja", "vi"] as const) {
      assert.deepEqual([...leaves(DICTIONARIES[lang].trainingLab).keys()].sort(), [...en.keys()].sort(), lang);
    }
  });

  it("has no empty strings, and function entries return non-empty text", () => {
    for (const lang of ["en", "ja", "vi"] as const) {
      for (const [path, leaf] of leaves(DICTIONARIES[lang].trainingLab)) {
        if (typeof leaf === "string") assert.ok(leaf.trim().length > 0, `${lang}.${path}`);
        else if (typeof leaf === "function") {
          const text: unknown = (leaf as (...args: number[]) => unknown)(3, 5, 7, 9);   // every entry function takes numbers
          assert.ok(typeof text === "string" && text.trim().length > 0, `${lang}.${path}()`);
        } else assert.fail(`${lang}.${path} is neither string nor function`);
      }
    }
  });

  it("covers every error kind and status", () => {
    const kinds = ["rate_limited", "queue_full", "client_limit", "global_limit", "invalid_field", "invalid_body", "forbidden_origin", "server_error", "disabled", "network", "not_found"];
    for (const lang of ["en", "ja", "vi"] as const) {
      assert.deepEqual(Object.keys(DICTIONARIES[lang].trainingLab.errors).sort(), [...kinds].sort());
      assert.deepEqual(Object.keys(DICTIONARIES[lang].trainingLab.status).sort(), ["cancelled", "failed", "queued", "running", "succeeded"]);
    }
  });
});

describe("retryIn humanizes the wait", () => {
  it("seconds under 90 s, minutes under 90 min, then hours; never a raw 3600 s", () => {
    const en = DICTIONARIES.en.trainingLab.retryIn;
    assert.equal(en(1), "Try again in 1 second.");
    assert.equal(en(45), "Try again in 45 seconds.");
    assert.equal(en(89), "Try again in 89 seconds.");
    assert.equal(en(90), "Try again in 2 minutes.");
    assert.equal(en(3600), "Try again in 60 minutes.");
    assert.equal(en(5399), "Try again in 90 minutes.");
    assert.equal(en(5400), "Try again in 2 hours.");
    assert.equal(en(86_400), "Try again in 24 hours.");
    assert.match(DICTIONARIES.ja.trainingLab.retryIn(120), /2分/);
    assert.match(DICTIONARIES.ja.trainingLab.retryIn(7200), /2時間/);
    assert.match(DICTIONARIES.ja.trainingLab.retryIn(30), /30秒/);
    assert.match(DICTIONARIES.vi.trainingLab.retryIn(120), /2 phút/);
    assert.match(DICTIONARIES.vi.trainingLab.retryIn(7200), /2 giờ/);
    for (const lang of ["en", "ja", "vi"] as const) assert.ok(!DICTIONARIES[lang].trainingLab.retryIn(3600).includes("3600"));
  });
});

describe("grid labels and vi wording", () => {
  it("localizes grid sizes", () => {
    assert.equal(DICTIONARIES.en.trainingLab.gridLabel(8), "Grid 8×8");
    assert.equal(DICTIONARIES.ja.trainingLab.gridLabel(8), "グリッド 8×8");
    assert.equal(DICTIONARIES.vi.trainingLab.gridLabel(8), "Lưới 8×8");
  });

  it("vi has no leftover English 'episode'", () => {
    const text = [...leaves(DICTIONARIES.vi.trainingLab).values()].filter((v) => typeof v === "string").join(" ");
    assert.ok(!/episode/i.test(text));
  });

  it("the origin and invalid_body messages are distinct", () => {
    for (const lang of ["en", "ja", "vi"] as const) {
      const { errors } = DICTIONARIES[lang].trainingLab;
      assert.notEqual(errors.forbidden_origin, errors.invalid_body);
    }
  });
});
