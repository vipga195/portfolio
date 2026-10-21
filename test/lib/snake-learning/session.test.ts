import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { MAX_GRID_SIZE, MIN_GRID_SIZE } from "../../../src/lib/game/snake.ts";
import { MIN_SECRET_LENGTH, deriveKey } from "../../../src/lib/snake-learning/keys.ts";
import {
  SESSION_MAX_AGE_SEC,
  createSession,
  signSession,
  verifySessionToken,
} from "../../../src/lib/snake-learning/session.ts";
import type { Session } from "../../../src/lib/snake-learning/session.ts";

// Fake secrets: these tests never read a real one
const SECRET = "test-secret-for-unit-tests-only-0123456789";
const OTHER_SECRET = "another-test-secret-for-unit-tests-9876543210";
const NOW = 1_800_000_000;
const SESSION: Session = { gridSize: 20, seed: 123456789, issuedAt: NOW };

// Builds a token with a VALID signature over arbitrary text, to test checks that come after the signature
function forge(payload: string, secret: string = SECRET): string {
  const sig = createHmac("sha256", deriveKey(secret, "snake-session")).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

describe("deriveKey", () => {
  test("rejects secrets that are too short or not strings", () => {
    assert.throws(() => deriveKey("short", "p"), /at least/);
    assert.throws(() => deriveKey("x".repeat(MIN_SECRET_LENGTH - 1), "p"));
    assert.doesNotThrow(() => deriveKey("x".repeat(MIN_SECRET_LENGTH), "p"));
    assert.throws(() => deriveKey(undefined as unknown as string, "p"));
  });

  test("gives different keys for different purposes and secrets", () => {
    assert.notDeepEqual(deriveKey(SECRET, "snake-session"), deriveKey(SECRET, "snake-source"));
    assert.notDeepEqual(deriveKey(SECRET, "snake-session"), deriveKey(OTHER_SECRET, "snake-session"));
    assert.deepEqual(deriveKey(SECRET, "snake-session"), deriveKey(SECRET, "snake-session"));
  });
});

describe("signSession / verifySessionToken", () => {
  test("a signed token verifies and returns exactly the session", () => {
    const token = signSession(SESSION, SECRET);
    assert.match(token, /^v1\.20\.123456789\.1800000000\.[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(verifySessionToken(token, SECRET, NOW + 10), { ok: true, session: SESSION });
  });

  test("works at the edges of the allowed values", () => {
    for (const session of [
      { gridSize: MIN_GRID_SIZE, seed: 0, issuedAt: 0 },
      { gridSize: MAX_GRID_SIZE, seed: 4294967295, issuedAt: NOW },
    ]) {
      const result = verifySessionToken(signSession(session, SECRET), SECRET, session.issuedAt);
      assert.deepEqual(result, { ok: true, session });
    }
  });

  test("refuses to sign an invalid session", () => {
    assert.throws(() => signSession({ ...SESSION, gridSize: MAX_GRID_SIZE + 1 }, SECRET));
    assert.throws(() => signSession({ ...SESSION, seed: 4294967296 }, SECRET));
    assert.throws(() => signSession({ ...SESSION, seed: -1 }, SECRET));
    assert.throws(() => signSession({ ...SESSION, seed: 1.5 }, SECRET));
  });

  test("changing any field of a valid token invalidates it", () => {
    const [version, grid, seed, issued, sig] = signSession(SESSION, SECRET).split(".");
    const tampered = [
      [version, "21", seed, issued, sig],
      [version, grid, "123456790", issued, sig],
      [version, grid, seed, "1800000001", sig],
      [version, grid, seed, issued, sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A")],
    ];
    for (const parts of tampered) {
      const result = verifySessionToken(parts.join("."), SECRET, NOW);
      assert.deepEqual(result, { ok: false, reason: "bad signature" });
    }
  });

  test("a different spelling of the same signature (padding bits) is rejected: one session, one token string", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const token = signSession(SESSION, SECRET);
    // The final character holds 4 data bits and 2 padding bits: flipping the lowest bit changes only padding
    const alternate = token.slice(0, -1) + alphabet[alphabet.indexOf(token.at(-1) as string) ^ 1];   // last char is a base64url character
    assert.notEqual(alternate, token);
    assert.equal(verifySessionToken(token, SECRET, NOW).ok, true);
    assert.deepEqual(verifySessionToken(alternate, SECRET, NOW), { ok: false, reason: "bad signature" });
  });

  test("a token signed with another secret is rejected", () => {
    assert.deepEqual(verifySessionToken(signSession(SESSION, OTHER_SECRET), SECRET, NOW), { ok: false, reason: "bad signature" });
  });

  test("a signature over the same text under another purpose key is rejected", () => {
    const payload = "v1.20.123456789.1800000000";
    const sig = createHmac("sha256", deriveKey(SECRET, "snake-source")).update(payload).digest("base64url");
    assert.deepEqual(verifySessionToken(`${payload}.${sig}`, SECRET, NOW), { ok: false, reason: "bad signature" });
  });

  test("rejects tokens that are too old, and accepts the boundary", () => {
    const token = signSession(SESSION, SECRET);
    assert.equal(verifySessionToken(token, SECRET, NOW + SESSION_MAX_AGE_SEC).ok, true);
    assert.deepEqual(verifySessionToken(token, SECRET, NOW + SESSION_MAX_AGE_SEC + 1), { ok: false, reason: "token expired" });
    assert.deepEqual(verifySessionToken(token, SECRET, NOW + 10, 5), { ok: false, reason: "token expired" });
  });

  test("rejects tokens from the future beyond the clock skew, and tolerates a small difference", () => {
    const token = signSession(SESSION, SECRET);
    assert.equal(verifySessionToken(token, SECRET, NOW - 60).ok, true);
    assert.deepEqual(verifySessionToken(token, SECRET, NOW - 61), { ok: false, reason: "token issued in the future" });
  });

  test("a validly signed token with out-of-range values is still rejected", () => {
    assert.deepEqual(verifySessionToken(forge("v1.99.5.1800000000"), SECRET, NOW), { ok: false, reason: "session values out of range" });
    assert.deepEqual(verifySessionToken(forge("v1.20.4294967296.1800000000"), SECRET, NOW), { ok: false, reason: "session values out of range" });
    assert.deepEqual(verifySessionToken(forge("v1.7.5.1800000000"), SECRET, NOW), { ok: false, reason: "session values out of range" });
  });

  test("malformed input is a result, never an exception", () => {
    const good = signSession(SESSION, SECRET);
    const bad: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      "",
      "x",
      "v1.20.123456789.1800000000",                    // no signature
      `${good}.extra`,                                  // too many parts
      good.replace("v1", "v2"),                         // unknown version
      "v1.-20.5.1800000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "v1.20.5.18e9.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "v1.20.5.1800000000.short",                       // signature of the wrong length
      "v1.20.5.1800000000." + "A".repeat(200),          // too long
      "v1.20.99999999999.1800000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ];
    for (const token of bad) {
      const result = verifySessionToken(token, SECRET, NOW);
      assert.equal(result.ok, false, `should reject ${String(token).slice(0, 40)}`);
    }
  });

  test("a bad server secret is a configuration error and throws", () => {
    assert.throws(() => verifySessionToken(signSession(SESSION, SECRET), "short", NOW));
  });
});

describe("createSession", () => {
  test("creates a verifiable session with the requested grid size and the given time", () => {
    const { session, token } = createSession(12, NOW, SECRET);
    assert.equal(session.gridSize, 12);
    assert.equal(session.issuedAt, NOW);
    assert.ok(Number.isInteger(session.seed) && session.seed >= 0 && session.seed < 4294967296);
    assert.deepEqual(verifySessionToken(token, SECRET, NOW), { ok: true, session });
  });

  test("seeds differ between sessions", () => {
    const seeds = new Set(Array.from({ length: 50 }, () => createSession(10, NOW, SECRET).session.seed));
    assert.ok(seeds.size > 45, `expected almost all seeds to differ, got ${seeds.size} distinct of 50`);
  });

  test("refuses an invalid grid size", () => {
    assert.throws(() => createSession(MAX_GRID_SIZE + 1, NOW, SECRET));
    assert.throws(() => createSession(Number.NaN, NOW, SECRET));
  });
});
