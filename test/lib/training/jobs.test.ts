import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_ERROR_LENGTH, MemoryJobStore, PgJobStore } from "../../../src/lib/training/jobs.ts";
import type { NewRun } from "../../../src/lib/training/jobs.ts";
import type { Pool } from "pg";

const job: NewRun = { game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 10 };

describe("MemoryJobStore", () => {
  it("claims in FIFO order and each run exactly once", async () => {
    const store = new MemoryJobStore();
    const a = await store.enqueue(job);
    const b = await store.enqueue(job);
    const c = await store.enqueue(job);
    const claimed = [];
    for (let i = 0; i < 4; i++) claimed.push(await store.claimNext("w", { maxRunning: 10 }));
    assert.deepEqual(claimed.map((r) => r?.id ?? null), [a.id, b.id, c.id, null]);
    assert.equal(claimed[0]?.status, "running");
    assert.equal(claimed[0]?.workerId, "w");
  });

  it("respects maxRunning", async () => {
    const store = new MemoryJobStore();
    await store.enqueue(job);
    await store.enqueue(job);
    const first = await store.claimNext("w", { maxRunning: 1 });
    assert.ok(first);
    assert.equal(await store.claimNext("w", { maxRunning: 1 }), null);
    await store.fail(first.id, "x");
    assert.ok(await store.claimNext("w", { maxRunning: 1 }));
  });

  it("cancels a queued run at once and flags a running one", async () => {
    const store = new MemoryJobStore();
    const queued = await store.enqueue(job);
    const running = await store.enqueue(job);
    await store.claimNext("w", { maxRunning: 10 }); // takes `queued`
    const second = await store.enqueue(job);
    assert.equal(await store.requestCancel(second.id), "cancelled");
    assert.equal((await store.getRun(second.id))?.status, "cancelled");
    assert.equal(await store.requestCancel(queued.id), "requested");
    assert.equal(await store.isCancelRequested(queued.id), true);
    assert.equal((await store.getRun(queued.id))?.status, "running");
    await store.finishCancelled(queued.id);
    assert.equal((await store.getRun(queued.id))?.status, "cancelled");
    assert.equal(await store.requestCancel(queued.id), "noop");
    assert.equal(await store.requestCancel(999), "not-found");
    assert.equal((await store.getRun(running.id))?.status, "queued");
  });

  it("failStale fails only running runs with an old heartbeat, and does not requeue", async () => {
    let now = 1_000_000;
    const store = new MemoryJobStore(() => now);
    const a = await store.enqueue(job);
    const b = await store.enqueue(job);
    await store.claimNext("w", { maxRunning: 10 });
    await store.claimNext("w", { maxRunning: 10 });
    now += 50_000;
    await store.heartbeat(b.id, 3);
    now += 20_000;
    assert.equal(await store.failStale(60_000), 1);
    const failed = await store.getRun(a.id);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.error, "worker lost");
    assert.equal((await store.getRun(b.id))?.status, "running");
    assert.equal(await store.claimNext("w", { maxRunning: 10 }), null);
  });

  it("returns metrics ordered by episode and replaces duplicates", async () => {
    const store = new MemoryJobStore();
    const run = await store.enqueue(job);
    await store.addMetric(run.id, { episode: 20, avg: 2, best: 3, loss: null });
    await store.addMetric(run.id, { episode: 10, avg: 1, best: 2, loss: 0.5 });
    await store.addMetric(run.id, { episode: 20, avg: 9, best: 9, loss: null });
    assert.deepEqual((await store.getMetrics(run.id)).map((m) => [m.episode, m.avg]), [[10, 1], [20, 9]]);
  });

  it("truncates failure messages", async () => {
    const store = new MemoryJobStore();
    const run = await store.enqueue(job);
    await store.fail(run.id, "x".repeat(2000));
    assert.equal((await store.getRun(run.id))?.error?.length, MAX_ERROR_LENGTH);
  });

  it("complete works only on running runs and records the brain", async () => {
    const store = new MemoryJobStore();
    const run = await store.enqueue(job);
    assert.equal(await store.complete(run.id, { brain: { featuresVersion: 2 }, eval: null, episodes: 10 }), false);
    await store.claimNext("w", { maxRunning: 1 });
    assert.equal(await store.complete(run.id, { brain: { featuresVersion: 2 }, eval: null, episodes: 10 }), true);
    assert.equal((await store.getRun(run.id))?.status, "succeeded");
    assert.equal((await store.getBrainInfo(run.id))?.featuresVersion, 2);
    await store.fail(run.id, "late");
    assert.equal((await store.getRun(run.id))?.status, "succeeded");
  });
});

describe("MemoryJobStore.requeue", () => {
  it("puts a running run back in the queue and clears its claim", async () => {
    const store = new MemoryJobStore();
    const run = await store.enqueue(job);
    assert.equal(await store.requeue(run.id), false);
    await store.claimNext("w", { maxRunning: 1 });
    assert.equal(await store.requeue(run.id), true);
    const back = await store.getRun(run.id);
    assert.equal(back?.status, "queued");
    assert.equal(back?.startedAt, null);
    assert.equal(back?.heartbeatAt, null);
    assert.equal(back?.workerId, null);
    assert.equal((await store.claimNext("w2", { maxRunning: 1 }))?.id, run.id);
    assert.equal(await store.requeue(999), false);
  });
});

// Stub pool whose client fails on chosen statements; records how the client was released
function stubPool(failOn: (sql: string) => boolean): { pool: Pool; released: unknown[]; queries: string[] } {
  const released: unknown[] = [];
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<{ rows: unknown[] }> => {
      queries.push(sql);
      if (failOn(sql)) throw new Error(`boom: ${sql.slice(0, 12)}`);
      return { rows: [{ ok: true, n: "5" }] };
    },
    release: (error?: unknown): void => void released.push(error),
  };
  // Only connect() is used by claimNext; the stub is not a full Pool
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, released, queries };
}

describe("PgJobStore connection handling", () => {
  it("destroys the connection (release(err)) when BEGIN throws", async () => {
    const { pool, released } = stubPool((sql) => sql === "BEGIN");
    await assert.rejects(new PgJobStore(pool).claimNext("w", { maxRunning: 1 }), /boom: BEGIN/);
    assert.equal(released.length, 1);
    assert.ok(released[0] instanceof Error);
  });

  it("destroys the connection and keeps the original error when ROLLBACK also throws", async () => {
    const { pool, released, queries } = stubPool((sql) => sql.startsWith("SELECT pg_try") || sql === "ROLLBACK");
    await assert.rejects(new PgJobStore(pool).claimNext("w", { maxRunning: 1 }), /boom: SELECT pg_t/);
    assert.ok(queries.includes("ROLLBACK"));
    assert.equal(released.length, 1);
    assert.match(String((released[0] as Error).message), /SELECT pg_t/);   // released with the original error
  });

  it("releases cleanly on success", async () => {
    const { pool, released } = stubPool(() => false);
    await new PgJobStore(pool).claimNext("w", { maxRunning: 1 });
    assert.deepEqual(released, [undefined]);
  });
});

describe("MemoryJobStore public views", () => {
  it("listPublicRuns and getBrainText skip trusted runs", async () => {
    const store = new MemoryJobStore();
    const pub = await store.enqueue(job);
    const trusted = await store.enqueue({ ...job, trusted: true });
    await store.claimNext("w", { maxRunning: 5 });
    await store.claimNext("w", { maxRunning: 5 });
    for (const id of [pub.id, trusted.id]) await store.complete(id, { brain: { featuresVersion: 2 }, eval: { overall: 1 }, episodes: 10 });
    assert.deepEqual((await store.listPublicRuns(10)).map((l) => l.run.id), [pub.id]);
    assert.equal(await store.getBrainText(pub.id), '{"featuresVersion":2}');
    assert.equal(await store.getBrainText(trusted.id), null);
  });
});
