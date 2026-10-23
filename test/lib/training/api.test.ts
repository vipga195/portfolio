import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clientKeyFromRequest, createRun, getRunBrain, getRunDetail, listRuns, toPublicRun } from "../../../src/lib/training/api.ts";
import type { ApiDeps } from "../../../src/lib/training/api.ts";
import { MemoryJobStore } from "../../../src/lib/training/jobs.ts";
import { createLimiter } from "../../../src/lib/training/limiter.ts";
import type { JobStore } from "../../../src/lib/training/jobs.ts";
import { DAY_MS } from "../../../src/lib/training/public-config.ts";
import type { PublicApiConfig, RateConfig } from "../../../src/lib/training/public-config.ts";

const LIMITS = { maxQueued: 5, maxActive: 6, perClient: 3, global: 100, windowMs: DAY_MS };
const URL_RUNS = "https://portfolio.cocahome.click/api/training/runs";

// Request budgets are huge by default so quota tests are not throttled; limiter tests pass their own rates
const BIG_RATES: RateConfig = { postPerClient: 100_000, postGlobal: 100_000, readPerClient: 100_000, readGlobal: 100_000, brainPerClient: 100_000, brainGlobal: 100_000 };

function makeDeps(overrides: { limits?: Partial<typeof LIMITS>; rates?: Partial<RateConfig>; enabled?: boolean; clock?: { now: number } } = {}): ApiDeps & { store: MemoryJobStore } {
  const clock = overrides.clock ?? { now: 1_800_000_000_000 };
  const config: PublicApiConfig = { enabled: overrides.enabled ?? true, limits: { ...LIMITS, ...overrides.limits }, rates: { ...BIG_RATES, ...overrides.rates }, ipSalt: null };
  return { store: new MemoryJobStore(() => clock.now), config, limiter: createLimiter({ now: () => clock.now }) };
}

const req = (ip?: string): Request => new Request(URL_RUNS, ip ? { headers: { "cf-connecting-ip": ip } } : undefined);
const throwingLimiter = { consume: (): never => { throw new Error("touched"); }, size: (): number => 0 };

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(URL_RUNS, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: text });
}

const good = { game: "snake", algorithm: "q-learning", episodes: 100 };

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;   // test helper: responses are JSON objects
}

// A store that fails loudly on any use
function explodingStore(message = "SELECT secret FROM training_runs failed at /app/src/x.ts"): JobStore {
  return new Proxy({}, { get: () => () => { throw new Error(message); } }) as JobStore;   // every method throws; only used to prove behaviour
}

describe("feature flag", () => {
  it("answers 404 training_disabled without touching the store", async () => {
    const deps: ApiDeps = { store: explodingStore(), config: { ...makeDeps().config, enabled: false }, limiter: throwingLimiter };
    for (const response of [await createRun(post(good), deps), await listRuns(new Request(URL_RUNS), deps), await getRunDetail(req(), "1", deps), await getRunBrain(req(), "1", deps)]) {
      assert.equal(response.status, 404);
      assert.deepEqual(await bodyOf(response), { error: "training_disabled" });
    }
  });
});

describe("POST /api/training/runs", () => {
  it("creates a run (201) and stores validated params and a hashed client key", async () => {
    const deps = makeDeps();
    const response = await createRun(post({ ...good, params: { alpha: 0.2 } }, { "cf-connecting-ip": "1.2.3.4" }), deps);
    assert.equal(response.status, 201);
    const { id } = await bodyOf(response);
    const run = await deps.store.getRun(Number(id));
    assert.equal(run?.status, "queued");
    assert.equal(run?.trusted, false);
    assert.deepEqual(run?.params, { alpha: 0.2, gamma: 0.9, epsilonStart: 1, epsilonEnd: 0.02, exploreFraction: 0.6 });
    assert.match(run?.ipHash ?? "", /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(run).includes("1.2.3.4"));
  });

  it("rejects invalid bodies and fields", async () => {
    const deps = makeDeps();
    const cases: [unknown, number, string, string?][] = [
      ["{not json", 400, "invalid_body"],
      ["[]", 400, "invalid_body"],
      ["null", 400, "invalid_body"],
      [{ ...good, extra: 1 }, 400, "invalid_body"],
      [{ ...good, game: "nope" }, 400, "invalid_field", "game"],
      [{ ...good, game: "__proto__" }, 400, "invalid_field", "game"],
      [{ ...good, game: 5 }, 400, "invalid_field", "game"],
      [{ ...good, algorithm: "constructor" }, 400, "invalid_field", "algorithm"],
      [{ ...good, episodes: 20_001 }, 400, "invalid_field", "episodes"],
      [{ ...good, episodes: 1.5 }, 400, "invalid_field", "episodes"],
      [{ ...good, episodes: "100" }, 400, "invalid_field", "episodes"],
      [{ game: "snake", algorithm: "dqn", episodes: 5001 }, 400, "invalid_field", "episodes"],
      [{ ...good, params: { evil: 1 } }, 400, "invalid_field", "params"],
      [{ ...good, params: { alpha: 5 } }, 400, "invalid_field", "params"],
      [{ ...good, params: "x" }, 400, "invalid_field", "params"],
    ];
    for (const [body, status, error, field] of cases) {
      const response = await createRun(post(body), deps);
      const json = await bodyOf(response);
      assert.equal(response.status, status, JSON.stringify(body));
      assert.equal(json.error, error, JSON.stringify(body));
      if (field) assert.equal(json.field, field);
    }
  });

  it("rejects an oversized body by header and by actual length (413)", async () => {
    const deps = makeDeps();
    const byHeader = await createRun(post(good, { "content-length": "5000" }), deps);
    assert.equal(byHeader.status, 413);
    const big = JSON.stringify({ ...good, params: { pad: "x".repeat(5000) } });
    const actual = await createRun(post(big), deps);
    assert.equal(actual.status, 413);
  });

  it("rejects a wrong content-type (415) and a foreign Origin (403), allows the site origin", async () => {
    const deps = makeDeps();
    assert.equal((await createRun(new Request(URL_RUNS, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(good) }), deps)).status, 415);
    assert.equal((await createRun(new Request(URL_RUNS, { method: "POST", body: JSON.stringify(good) }), deps)).status, 415);
    assert.equal((await createRun(post(good, { origin: "https://evil.example" }), deps)).status, 403);
    assert.equal((await createRun(post(good, { origin: "https://portfolio.cocahome.click" }), deps)).status, 201);
    assert.equal((await createRun(post(good, { "content-type": "application/json; charset=utf-8" }), deps)).status, 201);
  });

  it("a body literally equal to the old 'too_large' sentinel is an ordinary invalid body", async () => {
    const response = await createRun(post("too_large"), makeDeps());
    assert.equal(response.status, 400);
    assert.equal((await bodyOf(response)).error, "invalid_body");
  });
});

describe("request budgets", () => {
  it("POST: per client, and the global budget trips across many client keys", async () => {
    const deps = makeDeps({ rates: { postPerClient: 2, postGlobal: 5 }, limits: { maxQueued: 50, maxActive: 50, perClient: 50 } });
    const ip = { "cf-connecting-ip": "5.5.5.5" };
    assert.equal((await createRun(post(good, ip), deps)).status, 201);
    assert.equal((await createRun(post(good, ip), deps)).status, 201);
    const limited = await createRun(post(good, ip), deps);
    assert.equal(limited.status, 429);
    assert.equal((await bodyOf(limited)).error, "rate_limited");
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    // 3 more distinct clients fill the global budget of 5 (2 + 1 rejected-by-client does not count), then it trips
    const statuses: number[] = [];
    for (let i = 1; i <= 5; i++) statuses.push((await createRun(post(good, { "cf-connecting-ip": `6.6.6.${i}` }), deps)).status);
    assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
  });

  it("brain GET: 20 per client per minute, window rollover, and a global budget", async () => {
    const clock = { now: 1_800_000_000_000 };
    const deps = makeDeps({ clock, rates: { brainPerClient: 20, brainGlobal: 30 } });
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await getRunBrain(req("7.7.7.7"), "1", deps)).status);
    assert.equal(statuses.slice(0, 20).every((s) => s === 404), true);   // run 1 does not exist; the limiter still counts
    assert.equal(statuses[20], 429);
    clock.now += 60_001;
    assert.equal((await getRunBrain(req("7.7.7.7"), "1", deps)).status, 404);
    // global: 30 per minute regardless of client key (10 already used in this window by 7.7.7.7's single hit above)
    let tripped = 0;
    for (let i = 0; i < 40; i++) if ((await getRunBrain(req(`8.8.8.${i}`), "1", deps)).status === 429) tripped++;
    assert.equal(tripped, 40 - 29);
  });

  it("list and detail share the read budget", async () => {
    const deps = makeDeps({ rates: { readPerClient: 3 } });
    assert.equal((await listRuns(req("9.9.9.9"), deps)).status, 200);
    assert.equal((await getRunDetail(req("9.9.9.9"), "1", deps)).status, 404);
    assert.equal((await listRuns(req("9.9.9.9"), deps)).status, 200);
    assert.equal((await listRuns(req("9.9.9.9"), deps)).status, 429);
  });
});

describe("client key canonicalization", () => {
  const key = (ip: string): string => clientKeyFromRequest(new Request(URL_RUNS, { headers: { "cf-connecting-ip": ip } }));

  it("collapses spellings of one IPv6 address and IPv4-mapped addresses", () => {
    const k = key("2001:db8:1:2:3:4:5:6");
    assert.equal(key("2001:0DB8:0001:0002:0003:0004:0005:0006"), k);
    assert.equal(key("2001:db8:1:2::"), key("2001:db8:1:2:0:0:0:0"));
    assert.equal(key("::ffff:1.2.3.4"), "1.2.3.4");
    assert.equal(key("::ffff:0102:0304"), "1.2.3.4");
    assert.equal(key("1.2.3.4"), "1.2.3.4");
  });

  it("uses the /64: same /64 shares a key, different /64s do not, zone ids are stripped", () => {
    assert.equal(key("2001:db8:1:2::1"), key("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    assert.notEqual(key("2001:db8:1:2::1"), key("2001:db8:1:3::1"));
    assert.equal(key("fe80::1%eth0"), key("fe80::2"));
  });

  it("garbage and lists are 'unknown'", () => {
    for (const bad of ["", "nope", "1.2.3.4, 5.6.7.8", "999.1.1.1", "2001:db8::zz"]) assert.equal(key(bad), "unknown", bad);
    assert.equal(clientKeyFromRequest(new Request(URL_RUNS)), "unknown");
  });

  it("20 addresses in one /64 hit the per-client limit", async () => {
    const deps = makeDeps({ limits: { perClient: 3, maxQueued: 50, maxActive: 50 } });
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) statuses.push((await createRun(post(good, { "cf-connecting-ip": `2001:db8:abcd:1::${i + 1}` }), deps)).status);
    assert.equal(statuses.filter((s) => s === 201).length, 3);
    assert.equal(statuses.filter((s) => s === 429).length, 17);
  });
});

describe("quotas", () => {
  it("per-client limit isolates clients; invalid or missing headers share the 'unknown' bucket", async () => {
    const deps = makeDeps({ limits: { maxQueued: 50, maxActive: 50 } });
    const a = { "cf-connecting-ip": "1.1.1.1" };
    for (let i = 0; i < 3; i++) assert.equal((await createRun(post(good, a), deps)).status, 201);
    const fourth = await createRun(post(good, a), deps);
    assert.equal(fourth.status, 429);
    assert.equal((await bodyOf(fourth)).error, "client_limit");
    assert.ok(fourth.headers.get("retry-after"));
    assert.equal((await createRun(post(good, { "cf-connecting-ip": "2.2.2.2" }), deps)).status, 201);

    // Missing, malformed and x-forwarded-for only: all land in one bucket (3 allowed, then limited)
    const unknownish: Record<string, string>[] = [{}, { "cf-connecting-ip": "1.1.1.1, 9.9.9.9" }, { "x-forwarded-for": "7.7.7.7" }, { "cf-connecting-ip": "not-an-ip" }];
    const statuses: number[] = [];
    for (const headers of unknownish) statuses.push((await createRun(post(good, headers), deps)).status);
    assert.deepEqual(statuses, [201, 201, 201, 429]);
  });

  it("queue_full when the queue is at its cap", async () => {
    const deps = makeDeps({ limits: { maxQueued: 2, perClient: 50 } });
    for (let i = 0; i < 2; i++) assert.equal((await createRun(post(good), deps)).status, 201);
    const response = await createRun(post(good), deps);
    assert.equal(response.status, 429);
    assert.equal((await bodyOf(response)).error, "queue_full");
  });

  it("maxActive counts running runs too", async () => {
    const deps = makeDeps({ limits: { maxQueued: 10, maxActive: 2, perClient: 50 } });
    await createRun(post(good), deps);
    await createRun(post(good), deps);
    await deps.store.claimNext("w", { maxRunning: 5 });
    assert.equal((await bodyOf(await createRun(post(good), deps))).error, "queue_full");
  });

  it("global_limit, and it takes precedence over client_limit and queue_full", async () => {
    const deps = makeDeps({ limits: { global: 2, maxQueued: 2, perClient: 2 } });
    assert.equal((await createRun(post(good), deps)).status, 201);
    assert.equal((await createRun(post(good), deps)).status, 201);
    const response = await createRun(post(good), deps);
    assert.equal((await bodyOf(response)).error, "global_limit");
  });

  it("the window is rolling and uses the clock", async () => {
    const clock = { now: 1_800_000_000_000 };
    const deps = makeDeps({ clock, limits: { perClient: 1, maxQueued: 50, maxActive: 50 } });
    const headers = { "cf-connecting-ip": "3.3.3.3" };
    assert.equal((await createRun(post(good, headers), deps)).status, 201);
    clock.now += DAY_MS - 1000;
    assert.equal((await createRun(post(good, headers), deps)).status, 429);
    clock.now += 2000;
    assert.equal((await createRun(post(good, headers), deps)).status, 201);
  });

  it("trusted runs do not count toward public quotas", async () => {
    const deps = makeDeps({ limits: { global: 1, maxQueued: 50, maxActive: 50 } });
    await deps.store.enqueue({ game: "snake", algorithm: "dqn", params: {}, episodesTotal: 10, trusted: true });
    assert.equal((await createRun(post(good), deps)).status, 201);
  });
});

describe("GET list", () => {
  it("parses limit and returns public fields only", async () => {
    const deps = makeDeps({ limits: { perClient: 50, maxQueued: 50, maxActive: 50 } });
    for (let i = 0; i < 3; i++) await createRun(post(good, { "cf-connecting-ip": "4.4.4.4" }), deps);
    const response = await listRuns(new Request(`${URL_RUNS}?limit=2`), deps);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /s-maxage=2/);
    const { runs } = (await bodyOf(response)) as { runs: { id: number }[] };
    assert.deepEqual(runs.map((r) => r.id), [3, 2]);
    assert.equal((await bodyOf(await listRuns(new Request(URL_RUNS), deps))).runs instanceof Array, true);
    for (const bad of ["abc", "0", "51", "1.5", "-1", "1e1", ""]) {
      assert.equal((await listRuns(new Request(`${URL_RUNS}?limit=${bad}`), deps)).status, 400, bad);
    }
  });

  it("shows eval.overall only for succeeded runs", async () => {
    const deps = makeDeps();
    const run = await deps.store.enqueue({ game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 5 });
    await deps.store.claimNext("w", { maxRunning: 1 });
    await deps.store.complete(run.id, { brain: { featuresVersion: 2 }, eval: { overall: 12.5 }, episodes: 5 });
    const { runs } = (await bodyOf(await listRuns(new Request(URL_RUNS), deps))) as { runs: { eval: unknown }[] };
    assert.deepEqual(runs[0].eval, { overall: 12.5 });
  });
});

describe("GET detail and brain", () => {
  async function succeededRun(deps: ReturnType<typeof makeDeps>): Promise<number> {
    const run = await deps.store.enqueue({ game: "snake", algorithm: "q-learning", params: { alpha: 0.1 }, episodesTotal: 250, ipHash: "a".repeat(64) });
    await deps.store.claimNext("secret-worker", { maxRunning: 1 });
    for (let i = 1; i <= 250; i++) await deps.store.addMetric(run.id, { episode: i, avg: i, best: i, loss: null });
    await deps.store.complete(run.id, { brain: { game: "snake", featuresVersion: 2, q: [1] }, eval: { overall: 3, variants: [] }, episodes: 250 });
    return run.id;
  }

  it("rejects malformed ids with 404", async () => {
    const deps = makeDeps();
    for (const id of ["0", "01", "1e3", "9999999999999999999", "../x", "-1", "1.5", " 1", "", "abc"]) {
      assert.equal((await getRunDetail(req(), id, deps)).status, 404, id);
      assert.equal((await getRunBrain(req(), id, deps)).status, 404, id);
    }
    assert.equal((await getRunDetail(req(), "12345", deps)).status, 404);
  });

  it("returns detail with params, eval and at most 100 evenly thinned metrics", async () => {
    const deps = makeDeps();
    const id = await succeededRun(deps);
    const response = await getRunDetail(req(), String(id), deps);
    assert.equal(response.status, 200);
    const body = await bodyOf(response);
    assert.deepEqual(body.params, { alpha: 0.1 });
    const metrics = body.metrics as { episode: number }[];
    assert.equal(metrics.length, 100);
    assert.equal(metrics[0].episode, 1);
    assert.equal(metrics[99].episode, 250);
    assert.ok(metrics.every((m, i) => i === 0 || m.episode > metrics[i - 1].episode));
    assert.deepEqual(body.eval, { overall: 3 });
  });

  it("serves the brain with an immutable cache only for succeeded runs", async () => {
    const deps = makeDeps();
    const id = await succeededRun(deps);
    const ok = await getRunBrain(req(), String(id), deps);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "public, max-age=31536000, immutable");
    // The served bytes are exactly the stored JSON text
    assert.equal(await ok.text(), await deps.store.getBrainText(id));
    assert.equal(await deps.store.getBrainText(id), JSON.stringify({ game: "snake", featuresVersion: 2, q: [1] }));
    assert.match(ok.headers.get("content-type") ?? "", /^application\/json/);

    const queued = await deps.store.enqueue({ game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 5 });
    const notReady = await getRunBrain(req(), String(queued.id), deps);
    assert.equal(notReady.status, 404);
    assert.ok(!(notReady.headers.get("cache-control") ?? "").includes("immutable"));
  });

  it("public run JSON never contains internal fields", async () => {
    const deps = makeDeps();
    const id = await succeededRun(deps);
    const run = await deps.store.getRun(id);
    assert.ok(run);
    const texts = [JSON.stringify(toPublicRun(run, 3)), JSON.stringify(await bodyOf(await getRunDetail(req(), String(id), deps))), JSON.stringify(await bodyOf(await listRuns(new Request(URL_RUNS), deps)))];
    for (const text of texts) {
      for (const forbidden of ["ipHash", "ip_hash", "workerId", "worker_id", "secret-worker", "a".repeat(64)]) assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe("failures", () => {
  it("never leak SQL text or stack traces", async () => {
    const deps: ApiDeps = { store: explodingStore(), config: makeDeps().config, limiter: createLimiter() };
    const originalError = console.error;
    console.error = (): void => undefined;
    try {
      const responses = [await createRun(post(good), deps), await listRuns(new Request(URL_RUNS), deps), await getRunDetail(req(), "1", deps), await getRunBrain(req(), "1", deps)];
      for (const response of responses) {
        assert.equal(response.status, 500);
        const text = await response.text();
        assert.deepEqual(JSON.parse(text), { error: "server_error" });
        assert.ok(!/SELECT|secret|\/app|at /.test(text));
      }
    } finally {
      console.error = originalError;
    }
  });
});

describe("trusted runs are never public", () => {
  async function trustedSucceeded(deps: ReturnType<typeof makeDeps>): Promise<number> {
    const run = await deps.store.enqueue({ game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 5, trusted: true });
    await deps.store.claimNext("w", { maxRunning: 1 });
    await deps.store.complete(run.id, { brain: { featuresVersion: 2, q: [1] }, eval: { overall: 9 }, episodes: 5 });
    return run.id;
  }

  it("is absent from the list and answers detail and brain exactly like a missing id", async () => {
    const deps = makeDeps();
    const id = await trustedSucceeded(deps);
    const publicRun = await deps.store.enqueue({ game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 5 });

    const { runs } = (await bodyOf(await listRuns(req(), deps))) as { runs: { id: number }[] };
    assert.deepEqual(runs.map((r) => r.id), [publicRun.id]);

    for (const call of [getRunDetail, getRunBrain]) {
      const trusted = await call(req(), String(id), deps);
      const missing = await call(req(), "9999", deps);
      assert.equal(trusted.status, 404);
      assert.equal(await trusted.text(), await missing.text());
      assert.equal(trusted.headers.get("cache-control"), missing.headers.get("cache-control"));
    }
    assert.equal(await deps.store.getBrainText(id), null);
  });
});
