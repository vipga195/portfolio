import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDeps, withDeps } from "../../../src/lib/training/deps.ts";
import type { ApiDeps } from "../../../src/lib/training/api.ts";
import { MAX_GLOBAL_BUDGETS, createLimiter } from "../../../src/lib/training/limiter.ts";
import type { Limiter } from "../../../src/lib/training/limiter.ts";
import type { JobStore } from "../../../src/lib/training/jobs.ts";
import { DEFAULT_RATES, readPublicConfig } from "../../../src/lib/training/public-config.ts";

const RULE = { max: 3, windowMs: 1000 };
const BIG = { max: 1_000_000, windowMs: 60_000 };

// Charges one client key against a huge global budget unless a test says otherwise
function hit(limiter: Limiter, key: string, rule = RULE, global = { name: "g", rule: BIG }): boolean {
  return limiter.consume({ key, rule }, global).allowed;
}

describe("createLimiter", () => {
  it("allows up to max per window per key, reports Retry-After, and rolls over", () => {
    let now = 10_000;
    const limiter = createLimiter({ now: () => now });
    for (let i = 0; i < 3; i++) assert.equal(hit(limiter, "a"), true);
    const blocked = limiter.consume({ key: "a", rule: RULE }, { name: "g", rule: BIG });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);
    assert.equal(hit(limiter, "b"), true);
    now += 1000;
    assert.equal(hit(limiter, "a"), true);
  });

  it("keeps the per-client map at its cap after 100k unique keys", () => {
    const limiter = createLimiter({ maxKeys: 10_000 });
    for (let i = 0; i < 100_000; i++) hit(limiter, `k${i}`);
    assert.equal(limiter.size(), 10_000);
  });

  it("evicts the oldest client key first", () => {
    const limiter = createLimiter({ maxKeys: 2 });
    for (let i = 0; i < 3; i++) hit(limiter, "old");
    hit(limiter, "mid");
    hit(limiter, "new");   // evicts "old"
    assert.equal(hit(limiter, "old"), true);
  });

  it("flood regression: 100k unique client keys cannot get past a global budget of 600", () => {
    const limiter = createLimiter({ now: () => 5000, maxKeys: 10_000 });
    const global = { name: "read:global", rule: { max: 600, windowMs: 60_000 } };
    let allowed = 0;
    for (let i = 0; i < 100_000; i++) if (hit(limiter, `u${i}`, RULE, global)) allowed++;
    assert.equal(allowed, 600);
    assert.ok(limiter.size() <= 10_000);
    assert.equal(hit(limiter, "one-more", RULE, global), false);   // the global counter is intact
  });

  it("a request denied by the global budget changes no state", () => {
    let now = 1000;
    const limiter = createLimiter({ now: () => now });
    const global = { name: "g", rule: { max: 2, windowMs: 60_000 } };
    assert.equal(hit(limiter, "other1", RULE, global), true);
    assert.equal(hit(limiter, "other2", RULE, global), true);
    const before = limiter.size();
    for (let i = 0; i < 5; i++) assert.equal(hit(limiter, "real", RULE, global), false);   // denied by global
    assert.equal(limiter.size(), before);   // no junk key inserted
    now += 60_000;   // window rolls over: the real client still has its full allowance of 3
    const big = { name: "g", rule: BIG };
    assert.deepEqual([1, 2, 3, 4].map(() => hit(limiter, "real", { max: 3, windowMs: 60_000 }, big)), [true, true, true, false]);
  });

  it("a request denied by the per-client budget does not consume the global budget", () => {
    const limiter = createLimiter({ now: () => 1000 });
    const global = { name: "g", rule: { max: 5, windowMs: 60_000 } };
    for (let i = 0; i < 3; i++) hit(limiter, "greedy", RULE, global);
    for (let i = 0; i < 10; i++) assert.equal(hit(limiter, "greedy", RULE, global), false);
    assert.equal(hit(limiter, "x", RULE, global), true);
    assert.equal(hit(limiter, "y", RULE, global), true);
    assert.equal(hit(limiter, "z", RULE, global), false);   // exactly 5 were charged
  });

  it("reports the larger Retry-After when both budgets deny", () => {
    let now = 0;
    const limiter = createLimiter({ now: () => now });
    const clientRule = { max: 1, windowMs: 10_000 };
    const globalRule = { max: 1, windowMs: 60_000 };
    assert.equal(limiter.consume({ key: "a", rule: clientRule }, { name: "g", rule: globalRule }).allowed, true);
    now = 1000;
    assert.equal(limiter.consume({ key: "a", rule: clientRule }, { name: "g", rule: globalRule }).retryAfterSeconds, 59);
  });

  it("a clock that moves backwards starts a new window instead of extending the lock", () => {
    let now = 10_000_000;
    const limiter = createLimiter({ now: () => now });
    const global = { name: "g", rule: { max: 3, windowMs: 60_000 } };
    for (let i = 0; i < 3; i++) assert.equal(hit(limiter, "a", { max: 3, windowMs: 60_000 }, global), true);
    assert.equal(hit(limiter, "a", { max: 3, windowMs: 60_000 }, global), false);
    now -= 3_600_000;
    assert.equal(hit(limiter, "a", { max: 3, windowMs: 60_000 }, global), true);
  });

  it("throws a clear error beyond the cap of distinct global budget names, charging nothing", () => {
    const limiter = createLimiter();
    for (let i = 0; i < MAX_GLOBAL_BUDGETS; i++) assert.equal(hit(limiter, "c", { max: 1000, windowMs: 1000 }, { name: `g${i}`, rule: BIG }), true);
    const before = limiter.size();
    assert.throws(() => hit(limiter, "new-client", RULE, { name: "one-too-many", rule: BIG }), /distinct global budgets/);
    assert.equal(limiter.size(), before);
  });
});

describe("readPublicConfig rates", () => {
  it("has the documented defaults and rejects out-of-range values", () => {
    assert.deepEqual(readPublicConfig({}).rates, DEFAULT_RATES);
    assert.equal(readPublicConfig({ TRAINING_BRAIN_PER_CLIENT_PER_MIN: "5" }).rates.brainPerClient, 5);
    for (const bad of ["0", "-1", "1.5", "abc", "99999999"]) {
      assert.throws(() => readPublicConfig({ TRAINING_BRAIN_GLOBAL_PER_MIN: bad }), /TRAINING_BRAIN_GLOBAL_PER_MIN/, bad);
    }
  });
});

describe("createDeps / withDeps", () => {
  const limiter = createLimiter();
  const makeStore = (calls: string[]) => (): JobStore => {
    calls.push("store");
    return {} as JobStore;   // never used in these tests
  };

  it("flag off: neither the store nor the config factory is ever called", () => {
    const calls: string[] = [];
    const deps = createDeps({ enabled: false, makeStore: makeStore(calls), readConfig: () => { calls.push("config"); return readPublicConfig({}); }, limiter });
    assert.equal(deps.config.enabled, false);
    assert.deepEqual(calls, []);
  });

  it("flag on: each factory is called once per request", () => {
    const calls: string[] = [];
    const deps = createDeps({ enabled: true, makeStore: makeStore(calls), readConfig: () => { calls.push("config"); return readPublicConfig({ TRAINING_ENABLED: "true" }); }, limiter });
    assert.deepEqual(calls.sort(), ["config", "store"]);
    assert.equal(deps.config.enabled, true);
  });

  it("a throwing factory becomes a JSON 500 without internals", async () => {
    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const response = await withDeps(
        () => createDeps({ enabled: true, makeStore: () => { throw new Error("DATABASE_URL secret at /app/x"); }, readConfig: () => readPublicConfig({}), limiter }),
        async () => new Response("handler ran"),
      );
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "server_error" });
    } finally {
      console.error = originalError;
    }
  });

  it("passes the deps to the handler when wiring works", async () => {
    let seen: ApiDeps | null = null;
    await withDeps(() => createDeps({ enabled: false, makeStore: makeStore([]), readConfig: () => readPublicConfig({}), limiter }), async (deps) => {
      seen = deps;
      return new Response("ok");
    });
    assert.ok(seen);
  });
});
