// Runs only against a throwaway database: TEST_DATABASE_URL=postgres://... node --test test/lib/training/pg-job-store.test.ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Client, Pool } from "pg";

import { PgJobStore } from "../../../src/lib/training/jobs.ts";
import type { NewRun } from "../../../src/lib/training/jobs.ts";
import { checkTestDatabaseUrl } from "./db-guard.ts";
import { applyMigrations } from "../../../src/lib/training/migrations.ts";

const url = process.env.TEST_DATABASE_URL;
const job: NewRun = { game: "snake", algorithm: "q-learning", params: { alpha: 0.1 }, episodesTotal: 10 };

const refusal = url ? checkTestDatabaseUrl(url) : null;

if (!url) {
  // One visible placeholder so the summary shows the suite was skipped
  it("PgJobStore (Postgres)", { skip: "TEST_DATABASE_URL is not set" }, () => undefined);
} else if (refusal) {
  // These tests TRUNCATE tables: refuse loudly instead of skipping
  it("TEST_DATABASE_URL guard", () => assert.fail(refusal));
} else {
  registerSuite(url);
}

function registerSuite(connectionString: string): void {
describe("PgJobStore", () => {
  let pool: Pool;
  let store: PgJobStore;

  before(async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await applyMigrations(client, "db/migrations");
    } finally {
      await client.end();
    }
    pool = new Pool({ connectionString, max: 10 });
    store = new PgJobStore(pool);
  });

  after(async () => {
    await pool?.end();
  });

  async function reset(): Promise<void> {
    await pool.query("TRUNCATE training_runs RESTART IDENTITY CASCADE");
  }

  it("5 parallel claims over 3 queued runs: 3 distinct runs, 2 nulls", async () => {
    await reset();
    for (let i = 0; i < 3; i++) await store.enqueue(job);
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => store.claimNext(`w${n}`, { maxRunning: 10 })));
    const claimed = results.filter((r) => r !== null);
    assert.equal(claimed.length, 3);
    assert.equal(new Set(claimed.map((r) => r.id)).size, 3);
    assert.equal(results.length - claimed.length, 2);
  });

  it("maxRunning = 1 prevents a second concurrent claim", async () => {
    await reset();
    await store.enqueue(job);
    await store.enqueue(job);
    const results = await Promise.all([store.claimNext("a", { maxRunning: 1 }), store.claimNext("b", { maxRunning: 1 })]);
    assert.equal(results.filter((r) => r !== null).length, 1);
  });

  it("claims in FIFO order and round-trips params", async () => {
    await reset();
    const a = await store.enqueue(job);
    await store.enqueue(job);
    const first = await store.claimNext("w", { maxRunning: 5 });
    assert.equal(first?.id, a.id);
    assert.deepEqual(first?.params, { alpha: 0.1 });
    assert.equal(first?.status, "running");
  });

  it("CHECK constraints reject bad rows", async () => {
    await reset();
    await assert.rejects(store.enqueue({ ...job, episodesTotal: 0 }), /check constraint/);
    await assert.rejects(store.enqueue({ ...job, episodesTotal: 1_000_001 }), /check constraint/);
    await assert.rejects(pool.query("INSERT INTO training_runs (game, algorithm, episodes_total, status) VALUES ('s', 'a', 1, 'weird')"), /check constraint/);
  });

  it("stores a brain as JSONB and cascades deletes", async () => {
    await reset();
    const run = await store.enqueue(job);
    await store.claimNext("w", { maxRunning: 1 });
    await store.addMetric(run.id, { episode: 5, avg: 1.5, best: 3, loss: null });
    const brain = { game: "snake", featuresVersion: 2, q: [0, 1.5, -2] };
    assert.equal(await store.complete(run.id, { brain, eval: { overall: 1 }, episodes: 10 }), true);
    const row = await pool.query<{ data: unknown; eval: unknown; features_version: number }>("SELECT data, eval, features_version FROM brains WHERE run_id = $1", [run.id]);
    assert.deepEqual(row.rows[0].data, brain);
    assert.deepEqual(row.rows[0].eval, { overall: 1 });
    assert.equal(row.rows[0].features_version, 2);
    assert.equal((await store.getRun(run.id))?.status, "succeeded");
    assert.equal(await store.complete(run.id, { brain, eval: null, episodes: 10 }), false);

    await pool.query("DELETE FROM training_runs WHERE id = $1", [run.id]);
    assert.equal((await pool.query("SELECT 1 FROM training_metrics WHERE run_id = $1", [run.id])).rowCount, 0);
    assert.equal((await pool.query("SELECT 1 FROM brains WHERE run_id = $1", [run.id])).rowCount, 0);
  });

  it("failStale fails old running runs only; cancel and fail semantics", async () => {
    await reset();
    const stale = await store.enqueue(job);
    const fresh = await store.enqueue(job);
    const queued = await store.enqueue(job);
    await store.claimNext("w", { maxRunning: 5 });
    await store.claimNext("w", { maxRunning: 5 });
    await pool.query("UPDATE training_runs SET heartbeat_at = now() - interval '5 minutes' WHERE id = $1", [stale.id]);
    assert.equal(await store.failStale(60_000), 1);
    assert.equal((await store.getRun(stale.id))?.error, "worker lost");
    assert.equal((await store.getRun(fresh.id))?.status, "running");

    assert.equal(await store.requestCancel(queued.id), "cancelled");
    assert.equal(await store.requestCancel(fresh.id), "requested");
    assert.equal(await store.isCancelRequested(fresh.id), true);
    await store.finishCancelled(fresh.id);
    assert.equal((await store.getRun(fresh.id))?.status, "cancelled");
    assert.equal(await store.requestCancel(fresh.id), "noop");
    await store.fail(stale.id, "y".repeat(900));
    assert.equal((await store.getRun(stale.id))?.error, "worker lost");
  });

  it("requeue puts a running run back in the queue and nothing else", async () => {
    await reset();
    const run = await store.enqueue(job);
    assert.equal(await store.requeue(run.id), false);
    const claimed = await store.claimNext("w", { maxRunning: 1 });
    assert.ok(claimed?.startedAt);
    assert.equal(await store.requeue(run.id), true);
    const back = await store.getRun(run.id);
    assert.equal(back?.status, "queued");
    assert.equal(back?.startedAt, null);
    assert.equal(back?.heartbeatAt, null);
    assert.equal(back?.workerId, null);
    assert.equal((await store.claimNext("w2", { maxRunning: 1 }))?.id, run.id);
    assert.equal(await store.requeue(999), false);
  });

  it("enqueueWithQuota: 12 parallel calls with maxQueued 5 give exactly 5 ok and 7 queue_full", async () => {
    await reset();
    const limits = { maxQueued: 5, maxActive: 50, perClient: 100, global: 100, windowMs: 86_400_000 };
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => store.enqueueWithQuota({ ...job, ipHash: `${i}`.padEnd(64, "0") }, limits)));
    assert.equal(results.filter((r) => r.ok).length, 5);
    assert.equal(results.filter((r) => !r.ok && r.reason === "queue_full").length, 7);
  });

  it("enqueueWithQuota: per-client and global limits, precedence, trusted runs ignored, rolling window", async () => {
    await reset();
    const base = { maxQueued: 50, maxActive: 50, perClient: 2, global: 4, windowMs: 86_400_000 };
    const mine = { ...job, ipHash: "a".repeat(64) };
    assert.equal((await store.enqueueWithQuota(mine, base)).ok, true);
    assert.equal((await store.enqueueWithQuota(mine, base)).ok, true);
    const third = await store.enqueueWithQuota(mine, base);
    assert.deepEqual(third.ok ? null : third.reason, "client_limit");
    assert.equal((await store.enqueueWithQuota({ ...job, ipHash: "b".repeat(64) }, base)).ok, true);
    assert.equal((await store.enqueueWithQuota({ ...job, ipHash: "c".repeat(64) }, base)).ok, true);
    const full = await store.enqueueWithQuota({ ...job, ipHash: "d".repeat(64) }, { ...base, maxQueued: 1 });
    assert.deepEqual(full.ok ? null : full.reason, "global_limit");   // global wins over queue_full
    await store.enqueue({ ...job, trusted: true });   // trusted runs do not count
    const queueFull = await store.enqueueWithQuota({ ...job, ipHash: "d".repeat(64) }, { ...base, global: 100, maxQueued: 3 });
    assert.deepEqual(queueFull.ok ? null : queueFull.reason, "queue_full");

    await pool.query("UPDATE training_runs SET created_at = now() - interval '25 hours'");
    assert.equal((await store.enqueueWithQuota(mine, { ...base, maxQueued: 50 })).ok, true);
  });

  it("listPublicRuns and getBrain/getEval round trip", async () => {
    await reset();
    const a = await store.enqueue(job);
    const b = await store.enqueue(job);
    await store.claimNext("w", { maxRunning: 1 });
    await store.complete(a.id, { brain: { featuresVersion: 2, q: [1] }, eval: { overall: 4.5 }, episodes: 10 });
    const listed = await store.listPublicRuns(10);
    assert.deepEqual(listed.map((l) => l.run.id), [b.id, a.id]);
    assert.equal(listed[0].evalOverall, null);
    assert.equal(listed[1].evalOverall, 4.5);
    assert.deepEqual(await store.getBrain(a.id), { featuresVersion: 2, q: [1] });
    assert.deepEqual(await store.getEval(a.id), { overall: 4.5 });
    assert.equal(await store.getBrain(b.id), null);
    assert.equal((await store.listPublicRuns(1)).length, 1);
  });

  it("trusted runs are excluded from listPublicRuns and getBrainText; brain text equals SELECT data::text", async () => {
    await reset();
    const pub = await store.enqueue(job);
    const trusted = await store.enqueue({ ...job, trusted: true });
    await store.claimNext("w", { maxRunning: 5 });
    await store.claimNext("w", { maxRunning: 5 });
    const brain = { game: "snake", featuresVersion: 2, q: [0, 1.5, -2], nested: { a: 1, b: [1, 2] } };
    await store.complete(pub.id, { brain, eval: { overall: 1 }, episodes: 10 });
    await store.complete(trusted.id, { brain, eval: { overall: 1 }, episodes: 10 });
    assert.deepEqual((await store.listPublicRuns(10)).map((l) => l.run.id), [pub.id]);
    const text = await store.getBrainText(pub.id);
    const stored = await pool.query<{ text: string }>("SELECT data::text AS text FROM brains WHERE run_id = $1", [pub.id]);
    assert.equal(text, stored.rows[0].text);
    assert.deepEqual(JSON.parse(text ?? "null"), brain);
    assert.equal(await store.getBrainText(trusted.id), null);
    const queued = await store.enqueue(job);
    assert.equal(await store.getBrainText(queued.id), null);
  });

  it("running migrations again applies nothing and schema_migrations has the rows", async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const report = await applyMigrations(client, "db/migrations");
      assert.deepEqual(report.applied, []);
      assert.ok(report.skipped.includes("003_training.sql"));
      const rows = await client.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
      assert.deepEqual(rows.rows.map((r) => r.name), ["001_create_contact_messages.sql", "002_add_company_to_contact_messages.sql", "003_training.sql", "004_training_created_at_index.sql", "005_learning.sql", "006_learning_indexes.sql"]);
    } finally {
      await client.end();
    }
  });
});
}
