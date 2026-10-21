import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { maxMoves } from "../../../src/lib/game/replay.ts";
import { createLimiter } from "../../../src/lib/training/limiter.ts";
import { MemorySubmissionStore } from "../../../src/lib/training/submissions.ts";
import type { SubmissionStore } from "../../../src/lib/training/submissions.ts";
import { createSessionHandler, getBrain, submitGame } from "../../../src/lib/snake-learning/api.ts";
import type { LearningDeps } from "../../../src/lib/snake-learning/api.ts";
import { DISABLED_LEARNING_CONFIG, readLearningConfig } from "../../../src/lib/snake-learning/config.ts";
import type { LearningConfig } from "../../../src/lib/snake-learning/config.ts";
import { signSession } from "../../../src/lib/snake-learning/session.ts";
import { MAX_SUBMISSION_BYTES } from "../../../src/lib/snake-learning/submission.ts";

// Fake secret: these tests never read a real one
const SECRET = "test-secret-for-unit-tests-only-0123456789";
const NOW_MS = 1_800_000_000_000;
const NOW_SEC = NOW_MS / 1000;
const ORIGIN = "http://localhost:3000";

const ENABLED: LearningConfig = { ...readLearningConfig({ LEARNING_ENABLED: "true" }) };

function makeDeps(overrides: Partial<LearningDeps> = {}): LearningDeps {
  return {
    store: new MemorySubmissionStore(() => NOW_MS),
    config: ENABLED,
    limiter: createLimiter({ now: () => NOW_MS }),
    secret: SECRET,
    now: () => NOW_MS,
    ...overrides,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.5", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function tokenFor(seed: number, issuedAt = NOW_SEC, gridSize = 20): string {
  return signSession({ gridSize, seed, issuedAt }, SECRET);
}

function submit(deps: LearningDeps, seed: number, moves = "udlr", headers: Record<string, string> = {}): Promise<Response> {
  return submitGame(post("/api/learning/games", { token: tokenFor(seed), moves }, headers), deps);
}

// A store that fails the test when touched
const forbiddenStore = new Proxy({}, {
  get: () => () => {
    throw new Error("store must not be touched");
  },
}) as SubmissionStore;

async function publish(store: MemorySubmissionStore, featuresVersion: number): Promise<void> {
  await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain: { data: { w: [1, 2] }, eval: null, featuresVersion, episodes: 10 } });
}

describe("flag off", () => {
  test("all handlers answer 404 without touching store or limiter", async () => {
    let limiterCalls = 0;
    const deps = makeDeps({
      store: forbiddenStore,
      config: DISABLED_LEARNING_CONFIG,
      limiter: { consume: () => { limiterCalls++; return { allowed: true, retryAfterSeconds: 0 }; }, size: () => 0 },
    });
    for (const response of [
      await createSessionHandler(post("/api/learning/session", { gridSize: 20 }), deps),
      await submitGame(post("/api/learning/games", {}), deps),
      await getBrain(new Request(`${ORIGIN}/api/learning/brain?featuresVersion=1`), deps),
    ]) {
      assert.equal(response.status, 404);
    }
    assert.equal(limiterCalls, 0);
  });
});

describe("createSession", () => {
  test("returns token, gridSize and seed", async () => {
    const response = await createSessionHandler(post("/api/learning/session", { gridSize: 20 }), makeDeps());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.gridSize, 20);
    assert.equal(typeof body.token, "string");
    assert.ok(Number.isInteger(body.seed));
  });

  test("rejects an invalid gridSize", async () => {
    for (const gridSize of [3, 1000, 20.5, "20", null]) {
      const response = await createSessionHandler(post("/api/learning/session", { gridSize }), makeDeps());
      assert.equal(response.status, 400);
    }
  });
});

describe("submitGame", () => {
  test("happy path answers 202", async () => {
    const response = await submit(makeDeps(), 111);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true });
  });

  test("bad origin is 403", async () => {
    const response = await submit(makeDeps({ store: forbiddenStore }), 1, "udlr", { origin: "https://evil.example" });
    assert.equal(response.status, 403);
  });

  test("non-json content type is 415", async () => {
    const response = await submit(makeDeps({ store: forbiddenStore }), 1, "udlr", { "content-type": "text/plain" });
    assert.equal(response.status, 415);
  });

  test("oversized declared and actual bodies are 413", async () => {
    const declared = await submitGame(post("/api/learning/games", {}, { "content-length": String(MAX_SUBMISSION_BYTES + 1) }), makeDeps({ store: forbiddenStore }));
    assert.equal(declared.status, 413);
    // No Content-Length check can help here: the bytes actually read are counted
    const actual = await submitGame(post("/api/learning/games", "x".repeat(MAX_SUBMISSION_BYTES + 10)), makeDeps({ store: forbiddenStore }));
    assert.equal(actual.status, 413);
  });

  test("bad JSON is 400", async () => {
    const response = await submitGame(post("/api/learning/games", "{not json"), makeDeps({ store: forbiddenStore }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_body" });
  });

  test("bad, tampered and expired tokens are 401", async () => {
    const deps = makeDeps({ store: forbiddenStore });
    const bad = await submitGame(post("/api/learning/games", { token: "garbage", moves: "udlr" }), deps);
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { error: "invalid_token" });

    const tampered = tokenFor(5).replace(/^v1\.20\./, "v1.30.");
    const t = await submitGame(post("/api/learning/games", { token: tampered, moves: "udlr" }), deps);
    assert.equal(t.status, 401);
    assert.deepEqual(await t.json(), { error: "invalid_token" });

    const expired = await submitGame(post("/api/learning/games", { token: tokenFor(6, NOW_SEC - 2 * 3600), moves: "udlr" }), deps);
    assert.equal(expired.status, 401);
    assert.deepEqual(await expired.json(), { error: "token_expired" });
  });

  test("moves longer than the grid allows are 400", async () => {
    const moves = "u".repeat(maxMoves(20) + 1);
    const response = await submit(makeDeps({ store: forbiddenStore }), 7, moves);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_moves" });
  });

  test("the same seed twice is 409", async () => {
    const deps = makeDeps();
    assert.equal((await submit(deps, 42)).status, 202);
    const response = await submit(deps, 42, "udlr", { "cf-connecting-ip": "203.0.113.9" });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "duplicate_seed" });
  });

  test("quota limits are 429 with Retry-After", async () => {
    const perSource = makeDeps({ config: { ...ENABLED, limits: { ...ENABLED.limits, perSource: 1 } } });
    assert.equal((await submit(perSource, 1)).status, 202);
    const client = await submit(perSource, 2);
    assert.equal(client.status, 429);
    assert.equal((await client.json()).error, "client_limit");
    assert.ok(client.headers.get("retry-after"));

    const global = makeDeps({ config: { ...ENABLED, limits: { ...ENABLED.limits, global: 1 } } });
    assert.equal((await submit(global, 1)).status, 202);
    assert.equal((await (await submit(global, 2, "udlr", { "cf-connecting-ip": "203.0.113.9" })).json()).error, "global_limit");

    const queue = makeDeps({ config: { ...ENABLED, limits: { ...ENABLED.limits, maxPending: 1 } } });
    assert.equal((await submit(queue, 1)).status, 202);
    const full = await submit(queue, 2, "udlr", { "cf-connecting-ip": "203.0.113.9" });
    assert.equal(full.status, 429);
    assert.equal((await full.json()).error, "queue_full");
  });

  test("request rate limit is 429", async () => {
    const deps = makeDeps({ config: { ...ENABLED, rates: { ...ENABLED.rates, gamesPerClient: 1 } } });
    assert.equal((await submit(deps, 1)).status, 202);
    const response = await submit(deps, 2);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, "rate_limited");
  });
});

describe("getBrain", () => {
  const get = (deps: LearningDeps, query = "?featuresVersion=3"): Promise<Response> =>
    getBrain(new Request(`${ORIGIN}/api/learning/brain${query}`, { headers: { "cf-connecting-ip": "203.0.113.5" } }), deps);

  test("serves the published brain when featuresVersion matches", async () => {
    const store = new MemorySubmissionStore(() => NOW_MS);
    await publish(store, 3);
    const response = await get(makeDeps({ store }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /public/);
    const body = await response.json();
    assert.deepEqual(body.brain, { w: [1, 2] });
    assert.equal(body.featuresVersion, 3);
    assert.equal(body.brainId, 1);
    assert.equal(body.publishedAt, new Date(NOW_MS).toISOString());
  });

  test("404 when featuresVersion differs", async () => {
    const store = new MemorySubmissionStore(() => NOW_MS);
    await publish(store, 2);
    const response = await get(makeDeps({ store }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "no_published_brain" });
  });

  test("404 when nothing is published", async () => {
    const response = await get(makeDeps());
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "no_published_brain" });
  });

  test("400 for a missing or malformed featuresVersion", async () => {
    assert.equal((await get(makeDeps(), "")).status, 400);
    assert.equal((await get(makeDeps(), "?featuresVersion=abc")).status, 400);
  });
});

describe("config", () => {
  test("rejects out-of-range values instead of clamping", () => {
    assert.throws(() => readLearningConfig({ LEARNING_ENABLED: "true", LEARNING_MAX_PENDING: "0" }), /LEARNING_MAX_PENDING/);
    assert.throws(() => readLearningConfig({ LEARNING_PER_SOURCE_DAILY: "abc" }), /LEARNING_PER_SOURCE_DAILY/);
  });
  test("only the exact string true enables", () => {
    assert.equal(readLearningConfig({ LEARNING_ENABLED: "TRUE" }).enabled, false);
    assert.equal(readLearningConfig({ LEARNING_ENABLED: "true" }).enabled, true);
  });
});
