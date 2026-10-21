import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemorySubmissionStore } from "../../../src/lib/training/submissions.ts";
import type { NewSubmission, SubmissionLimits } from "../../../src/lib/training/submissions.ts";

const limits: SubmissionLimits = { perSource: 3, global: 10, maxPending: 20, windowMs: 60_000 };
const sub = (seed: number, sourceHash = "aaaaaaaaaaaaaaaa", game = "snake"): NewSubmission => ({ game, variant: "10", seed, moves: "rrdd", sourceHash });
const brain = { data: { q: [1] }, eval: { overall: 70 }, featuresVersion: 2, episodes: 5 };

describe("MemorySubmissionStore", () => {
  it("adds and lists pending oldest first, honoring game and limit", async () => {
    const store = new MemorySubmissionStore();
    await store.addWithQuota(sub(1), limits);
    await store.addWithQuota(sub(2), limits);
    await store.addWithQuota(sub(3, "bbbbbbbbbbbbbbbb", "other"), limits);
    const pending = await store.listPending("snake", 10);
    assert.deepEqual(pending.map((s) => s.seed), [1, 2]);
    assert.equal((await store.listPending("snake", 1)).length, 1);
  });

  it("rejects a duplicate (game, seed) in any status, but allows the same seed in another game", async () => {
    const store = new MemorySubmissionStore();
    const first = await store.addWithQuota(sub(7), limits);
    assert.deepEqual(await store.addWithQuota(sub(7, "bbbbbbbbbbbbbbbb"), limits), { ok: false, reason: "duplicate_seed" });
    assert.ok(first.ok);
    await store.recordGeneration({ game: "snake", usedIds: [first.id], rejected: [], brain: null });
    assert.deepEqual(await store.addWithQuota(sub(7), limits), { ok: false, reason: "duplicate_seed" });
    assert.equal((await store.addWithQuota(sub(7, "aaaaaaaaaaaaaaaa", "other"), limits)).ok, true);
  });

  it("enforces client_limit, global_limit and queue_full, and the window expires", async () => {
    let t = 1_000_000;
    const store = new MemorySubmissionStore(() => t);
    for (let i = 0; i < 3; i++) assert.equal((await store.addWithQuota(sub(i), limits)).ok, true);
    assert.deepEqual(await store.addWithQuota(sub(10), limits), { ok: false, reason: "client_limit" });
    assert.equal((await store.addWithQuota(sub(11, "bbbbbbbbbbbbbbbb"), limits)).ok, true);
    assert.deepEqual(await store.addWithQuota(sub(12, "cccccccccccccccc"), { ...limits, global: 4 }), { ok: false, reason: "global_limit" });
    assert.deepEqual(await store.addWithQuota(sub(13, "cccccccccccccccc"), { ...limits, maxPending: 4 }), { ok: false, reason: "queue_full" });
    t += 60_001;
    assert.equal((await store.addWithQuota(sub(14), limits)).ok, true);
  });

  it("recordGeneration marks used/rejected and publishes a brain", async () => {
    const store = new MemorySubmissionStore();
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await store.addWithQuota(sub(i), limits);
      assert.ok(r.ok);
      ids.push(r.id);
    }
    await store.recordGeneration({ game: "snake", usedIds: [ids[0]], rejected: [{ id: ids[1], reason: "bad" }], brain });
    assert.deepEqual((await store.listPending("snake", 10)).map((s) => s.id), [ids[2]]);
    const published = await store.getPublished("snake");
    assert.ok(published);
    assert.deepEqual(published.data, brain.data);
    assert.deepEqual(published.eval, brain.eval);
    assert.equal(published.featuresVersion, 2);
  });

  it("recordGeneration with a null brain publishes nothing", async () => {
    const store = new MemorySubmissionStore();
    const r = await store.addWithQuota(sub(1), limits);
    assert.ok(r.ok);
    await store.recordGeneration({ game: "snake", usedIds: [], rejected: [{ id: r.id, reason: "x" }], brain: null });
    assert.equal(await store.getPublished("snake"), null);
    assert.equal((await store.listPending("snake", 10)).length, 0);
  });

  it("getPublished is null for an unknown game and the newest generation wins", async () => {
    const store = new MemorySubmissionStore();
    assert.equal(await store.getPublished("snake"), null);
    await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain });
    await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain: { ...brain, data: { q: [2] } } });
    assert.deepEqual((await store.getPublished("snake"))?.data, { q: [2] });
    assert.equal(await store.getPublished("other"), null);
  });

  it("rollback restores an older brain or the built-in one, never touching history", async () => {
    const store = new MemorySubmissionStore();
    await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain });
    const first = await store.getPublished("snake");
    assert.ok(first);
    await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain: { ...brain, data: { q: [2] } } });
    await store.rollback("snake", first.brainId);
    assert.equal((await store.getPublished("snake"))?.brainId, first.brainId);
    await store.rollback("snake", null);
    assert.equal(await store.getPublished("snake"), null);
  });

  it("rollback rejects a brain of another game or an unknown brain", async () => {
    const store = new MemorySubmissionStore();
    await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain });
    const published = await store.getPublished("snake");
    assert.ok(published);
    await assert.rejects(store.rollback("other", published.brainId));
    await assert.rejects(store.rollback("snake", 999));
    assert.equal((await store.getPublished("snake"))?.brainId, published.brainId);
  });

  it("rollback rejects a brain whose run is not trusted and writes nothing", async () => {
    const store = new MemorySubmissionStore();
    await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain });
    const untrusted = store.addUntrustedBrainForTest("snake", { q: [9] }, 2);
    await assert.rejects(store.rollback("snake", untrusted), /not trusted/);
    assert.equal((await store.getPublished("snake"))?.brainId, 1);
  });

  it("submissions of another game do not consume this game's quota", async () => {
    const store = new MemorySubmissionStore();
    const tight: SubmissionLimits = { perSource: 1, global: 1, maxPending: 1, windowMs: 60_000 };
    assert.equal((await store.addWithQuota(sub(1, "bbbbbbbbbbbbbbbb", "other"), tight)).ok, true);
    assert.equal((await store.addWithQuota(sub(2), tight)).ok, true);
    assert.deepEqual(await store.addWithQuota(sub(3), tight), { ok: false, reason: "global_limit" });
  });

  it("episodes above the run limit are clamped, not rejected", async () => {
    const store = new MemorySubmissionStore();
    await store.recordGeneration({ game: "snake", usedIds: [], rejected: [], brain: { ...brain, episodes: 5_000_000 } });
    assert.ok(await store.getPublished("snake"));
  });

  it("purge deletes only old used/rejected submissions", async () => {
    let t = 1_000_000;
    const store = new MemorySubmissionStore(() => t);
    const a = await store.addWithQuota(sub(1), limits);
    const b = await store.addWithQuota(sub(2), limits);
    const c = await store.addWithQuota(sub(3, "bbbbbbbbbbbbbbbb"), limits);
    assert.ok(a.ok && b.ok && c.ok);
    await store.recordGeneration({ game: "snake", usedIds: [a.id], rejected: [{ id: b.id, reason: "x" }], brain: null });
    t += 10_000;
    const d = await store.addWithQuota(sub(4, "bbbbbbbbbbbbbbbb"), limits);
    assert.ok(d.ok);
    await store.recordGeneration({ game: "snake", usedIds: [d.id], rejected: [], brain: null });
    // a, b are old and finished (deleted); c is old but pending (kept); d is new (kept)
    assert.equal(await store.purge(new Date(t - 5_000)), 2);
    assert.deepEqual((await store.listPending("snake", 10)).map((s) => s.id), [c.id]);
    // Seeds of deleted rows can be submitted again
    assert.equal((await store.addWithQuota(sub(1), limits)).ok, true);
  });
});
