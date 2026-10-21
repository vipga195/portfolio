// Runs only against a throwaway database: TEST_DATABASE_URL=postgres://... node --test test/lib/training/pg-submission-store.test.ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Client, Pool } from "pg";

import { applyMigrations } from "../../../src/lib/training/migrations.ts";
import { PgSubmissionStore } from "../../../src/lib/training/submissions.ts";
import type { NewSubmission, SubmissionLimits } from "../../../src/lib/training/submissions.ts";
import { checkTestDatabaseUrl } from "./db-guard.ts";

const url = process.env.TEST_DATABASE_URL;
const limits: SubmissionLimits = { perSource: 3, global: 10, maxPending: 20, windowMs: 60_000 };
const sub = (seed: number, sourceHash = "aaaaaaaaaaaaaaaa", game = "snake"): NewSubmission => ({ game, variant: "10", seed, moves: "rrdd", sourceHash });
const brain = { data: { featuresVersion: 2, q: [1] }, eval: { overall: 70 }, featuresVersion: 2, episodes: 5 };

const refusal = url ? checkTestDatabaseUrl(url) : null;

if (!url) {
  it("PgSubmissionStore (Postgres)", { skip: "TEST_DATABASE_URL is not set" }, () => undefined);
} else if (refusal) {
  // These tests TRUNCATE tables: refuse loudly instead of skipping
  it("TEST_DATABASE_URL guard", () => assert.fail(refusal));
} else {
  registerSuite(url);
}

function registerSuite(connectionString: string): void {
  describe("PgSubmissionStore", () => {
    let pool: Pool;
    let store: PgSubmissionStore;

    before(async () => {
      const client = new Client({ connectionString });
      await client.connect();
      try {
        await applyMigrations(client, "db/migrations");
      } finally {
        await client.end();
      }
      pool = new Pool({ connectionString, max: 10 });
      store = new PgSubmissionStore(pool);
    });

    after(async () => {
      await pool?.end();
    });

    async function reset(): Promise<void> {
      await pool.query("TRUNCATE game_submissions, brain_publications, training_runs RESTART IDENTITY CASCADE");
    }

    it("adds, lists pending in order and returns numeric seed/id", async () => {
      await reset();
      const a = await store.addWithQuota(sub(5), limits);
      await store.addWithQuota(sub(4), limits);
      assert.ok(a.ok);
      assert.equal(typeof a.id, "number");
      const pending = await store.listPending("snake", 10);
      assert.deepEqual(pending.map((s) => s.seed), [5, 4]);
      assert.equal(pending[0].moves, "rrdd");
      assert.equal((await store.listPending("snake", 1)).length, 1);
    });

    it("rejects duplicate seeds in any status; 20 parallel same-seed adds insert exactly one", async () => {
      await reset();
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => store.addWithQuota(sub(9, `${String(i).padStart(16, "0")}`), limits)));
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "duplicate_seed"));
      const first = results.find((r) => r.ok);
      assert.ok(first?.ok);
      await store.recordGeneration({ game: "snake", usedIds: [first.id], rejected: [], brain: null });
      assert.deepEqual(await store.addWithQuota(sub(9), limits), { ok: false, reason: "duplicate_seed" });
    });

    it("quota is atomic under parallel adds and reports each reason", async () => {
      await reset();
      const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => store.addWithQuota(sub(100 + i), limits)));
      assert.equal(parallel.filter((r) => r.ok).length, 3);
      assert.ok(parallel.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "client_limit"));
      assert.deepEqual(await store.addWithQuota(sub(200, "cccccccccccccccc"), { ...limits, global: 3 }), { ok: false, reason: "global_limit" });
      assert.deepEqual(await store.addWithQuota(sub(201, "cccccccccccccccc"), { ...limits, maxPending: 3 }), { ok: false, reason: "queue_full" });
      assert.equal((await store.addWithQuota(sub(202, "cccccccccccccccc"), limits)).ok, true);
    });

    it("recordGeneration marks submissions and writes run + brain + publication", async () => {
      await reset();
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await store.addWithQuota(sub(i), limits);
        assert.ok(r.ok);
        ids.push(r.id);
      }
      await store.recordGeneration({ game: "snake", usedIds: [ids[0]], rejected: [{ id: ids[1], reason: "bad" }], brain: { ...brain, episodes: 0 } });
      assert.deepEqual((await store.listPending("snake", 10)).map((s) => s.id), [ids[2]]);
      const rows = await pool.query("SELECT id, status, reject_reason FROM game_submissions ORDER BY id");
      assert.deepEqual(rows.rows.map((r) => [r.status, r.reject_reason]), [["used", null], ["rejected", "bad"], ["pending", null]]);
      const run = await pool.query("SELECT algorithm, trusted, status, episodes_total, episodes_done FROM training_runs");
      assert.deepEqual(run.rows, [{ algorithm: "qlearning", trusted: true, status: "succeeded", episodes_total: 1, episodes_done: 1 }]);
      const published = await store.getPublished("snake");
      assert.ok(published);
      assert.deepEqual(published.data, brain.data);
      assert.deepEqual(published.eval, brain.eval);
      assert.equal(published.featuresVersion, 2);
      assert.ok(published.publishedAt instanceof Date);
    });

    it("recordGeneration rolls back everything when the brain insert fails", async () => {
      await reset();
      const r = await store.addWithQuota(sub(1), limits);
      assert.ok(r.ok);
      // featuresVersion NaN is rejected by Postgres at the brains insert, after the submission update and run insert
      await assert.rejects(
        store.recordGeneration({ game: "snake", usedIds: [r.id], rejected: [], brain: { ...brain, featuresVersion: Number.NaN } }),
      );
      assert.equal((await store.listPending("snake", 10)).length, 1);
      assert.equal((await pool.query("SELECT 1 FROM training_runs")).rowCount, 0);
      assert.equal((await pool.query("SELECT 1 FROM brain_publications")).rowCount, 0);
      // The pool still works after the failed transaction
      assert.equal((await store.addWithQuota(sub(2), limits)).ok, true);
    });

    it("getPublished is null with no publication; rollback is append-only and null means built-in", async () => {
      await reset();
      assert.equal(await store.getPublished("snake"), null);
      await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain });
      const first = await store.getPublished("snake");
      assert.ok(first);
      await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain: { ...brain, data: { featuresVersion: 2, q: [2] } } });
      assert.deepEqual((await store.getPublished("snake"))?.data, { featuresVersion: 2, q: [2] });
      await store.rollback("snake", first.brainId);
      assert.equal((await store.getPublished("snake"))?.brainId, first.brainId);
      await store.rollback("snake", null);
      assert.equal(await store.getPublished("snake"), null);
      const log = await pool.query("SELECT reason, brain_id FROM brain_publications ORDER BY id");
      assert.deepEqual(log.rows.map((r) => r.reason), ["generation", "generation", "rollback", "rollback"]);
      assert.equal(log.rows[3].brain_id, null);
    });

    it("rollback rejects a brain of another game or an unknown brain and writes nothing", async () => {
      await reset();
      await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain });
      const published = await store.getPublished("snake");
      assert.ok(published);
      await assert.rejects(store.rollback("other", published.brainId));
      await assert.rejects(store.rollback("snake", 999_999));
      assert.equal((await pool.query("SELECT 1 FROM brain_publications")).rowCount, 1);
    });

    it("rollback rejects a brain whose run is not trusted and writes nothing", async () => {
      await reset();
      const run = await pool.query<{ id: string }>(
        "INSERT INTO training_runs (game, algorithm, episodes_total, status, trusted) VALUES ('snake', 'qlearning', 5, 'succeeded', false) RETURNING id",
      );
      const inserted = await pool.query<{ id: string }>(
        "INSERT INTO brains (run_id, game, algorithm, features_version, episodes, data) VALUES ($1, 'snake', 'qlearning', 2, 5, '{}'::jsonb) RETURNING id",
        [run.rows[0].id],
      );
      await assert.rejects(store.rollback("snake", Number(inserted.rows[0].id)), /not trusted/);
      assert.equal((await pool.query("SELECT 1 FROM brain_publications")).rowCount, 0);
    });

    it("submissions of another game do not consume this game's quota", async () => {
      await reset();
      const tight: SubmissionLimits = { perSource: 1, global: 1, maxPending: 1, windowMs: 60_000 };
      assert.equal((await store.addWithQuota(sub(1, "bbbbbbbbbbbbbbbb", "other"), tight)).ok, true);
      assert.equal((await store.addWithQuota(sub(2), tight)).ok, true);
      assert.deepEqual(await store.addWithQuota(sub(3), tight), { ok: false, reason: "global_limit" });
      // An old pending row still counts toward the backlog even outside the window
      await pool.query("UPDATE game_submissions SET created_at = now() - interval '2 days'");
      assert.deepEqual(await store.addWithQuota(sub(4), { ...tight, global: 10, perSource: 10 }), { ok: false, reason: "queue_full" });
    });

    it("episodes above the run limit are clamped to the CHECK maximum", async () => {
      await reset();
      await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain: { ...brain, episodes: 5_000_000 } });
      const run = await pool.query("SELECT episodes_total FROM training_runs");
      assert.equal(run.rows[0].episodes_total, 1_000_000);
    });

    it("purge deletes only old used/rejected submissions", async () => {
      await reset();
      const a = await store.addWithQuota(sub(1), limits);
      const b = await store.addWithQuota(sub(2), limits);
      const c = await store.addWithQuota(sub(3, "bbbbbbbbbbbbbbbb"), limits);
      const d = await store.addWithQuota(sub(4, "bbbbbbbbbbbbbbbb"), limits);
      assert.ok(a.ok && b.ok && c.ok && d.ok);
      await store.recordGeneration({ game: "snake", usedIds: [a.id, d.id], rejected: [{ id: b.id, reason: "x" }], brain: null });
      await pool.query("UPDATE game_submissions SET created_at = now() - interval '2 days' WHERE id = ANY($1::bigint[])", [[a.id, b.id, c.id]]);
      assert.equal(await store.purge(new Date(Date.now() - 24 * 3600 * 1000)), 2);
      const left = await pool.query("SELECT id FROM game_submissions ORDER BY id");
      assert.deepEqual(left.rows.map((r) => Number(r.id)), [c.id, d.id]);
    });
  });
}
