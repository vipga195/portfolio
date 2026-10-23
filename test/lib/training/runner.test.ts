import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Worker } from "node:worker_threads";

import { getAlgorithm, getGame } from "../../../src/lib/registry.ts";
import { MemoryJobStore } from "../../../src/lib/training/jobs.ts";
import type { NewRun } from "../../../src/lib/training/jobs.ts";
import { brainFitsLimit, runJob, shortMessage } from "../../../src/lib/training/runner.ts";
import type { RunOptions } from "../../../src/lib/training/runner.ts";

const SMALL_DQN = { hidden: [16], replaySize: 2000, warmupSteps: 100, batchSize: 16, targetSyncEvery: 100 };

async function start(newRun: NewRun, options: RunOptions = {}) {
  const store = new MemoryJobStore();
  await store.enqueue(newRun);
  const claimed = await store.claimNext("test", { maxRunning: 1 });
  assert.ok(claimed);
  const workers: Worker[] = [];
  const promise = runJob(store, claimed, { evalGames: 2, heartbeatMs: 50, cancelPollMs: 25, onWorker: (w) => workers.push(w), ...options });
  return { store, id: claimed.id, workers, promise };
}

describe("runJob", () => {
  for (const [algorithm, params, episodes] of [["q-learning", {}, 40], ["dqn", SMALL_DQN, 15]] as const) {
    it(`${algorithm} succeeds with metrics and a parseable brain`, async () => {
      const { store, id, promise } = await start({ game: "snake", algorithm, params, episodesTotal: episodes });
      await promise;
      const run = await store.getRun(id);
      assert.equal(run?.status, "succeeded", run?.error ?? "");
      assert.equal(run?.episodesDone, episodes);
      const metrics = await store.getMetrics(id);
      assert.ok(metrics.length >= 1 && metrics.length <= 51, `${metrics.length} metrics`);
      assert.equal(metrics.at(-1)?.episode, episodes);
      const info = await store.getBrainInfo(id);
      assert.ok(info && info.sizeBytes > 0);
      const alg = getAlgorithm(algorithm);
      const game = getGame("snake");
      assert.ok(alg && game);
      assert.equal(info.featuresVersion, (algorithm === "dqn" ? game.dense?.featuresVersion : game.tabular?.featuresVersion));
    });
  }

  it("rejects bad jobs without spawning a worker", async () => {
    const bad: [NewRun, RegExp][] = [
      [{ game: "nope", algorithm: "dqn", params: {}, episodesTotal: 10 }, /unknown game/],
      [{ game: "snake", algorithm: "__proto__", params: {}, episodesTotal: 10 }, /unknown algorithm/],
      [{ game: "snake", algorithm: "dqn", params: { evil: 1 }, episodesTotal: 10 }, /invalid params/],
      [{ game: "snake", algorithm: "dqn", params: {}, episodesTotal: 5_001 }, /episodes must be 1\.\.5000/],
      [{ game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 20_001 }, /episodes must be/],
      [{ game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 1_000_001, trusted: true }, /invalid episodes/],
    ];
    for (const [newRun, pattern] of bad) {
      const { store, id, workers, promise } = await start(newRun);
      await promise;
      const run = await store.getRun(id);
      assert.equal(run?.status, "failed");
      assert.match(run?.error ?? "", pattern);
      assert.equal(workers.length, 0);
    }
  });

  it("fails a run that exceeds the time limit and the worker is gone", async () => {
    const { store, id, workers, promise } = await start(
      { game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 1_000_000, trusted: true },
      { maxRuntimeMs: 200 },
    );
    await promise;
    const run = await store.getRun(id);
    assert.equal(run?.status, "failed");
    assert.equal(run?.error, "time limit exceeded");
    assert.equal(workers[0].threadId, -1);
  });

  it("cancels a running job", async () => {
    const { store, id, workers, promise } = await start({ game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 1_000_000, trusted: true });
    setTimeout(() => void store.requestCancel(id), 150);
    await promise;
    assert.equal((await store.getRun(id))?.status, "cancelled");
    assert.equal(workers[0].threadId, -1);
  });

  it("marks the run failed when the worker crashes", async () => {
    const { store, id, promise } = await start(
      { game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 10 },
      { workerUrl: new URL("./crash-worker.ts", import.meta.url) },
    );
    await promise;
    const run = await store.getRun(id);
    assert.equal(run?.status, "failed");
    assert.match(run?.error ?? "", /exited with code 3/);
  });

  it("stops and fails the run on abort (shutdown)", async () => {
    const controller = new AbortController();
    const { store, id, promise } = await start(
      { game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 1_000_000, trusted: true },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 100);
    await promise;
    assert.equal((await store.getRun(id))?.error, "shutdown");
  });

  it("a pre-aborted signal fails the run with 'shutdown' without spawning a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    const { store, id, workers, promise } = await start({ game: "snake", algorithm: "q-learning", params: {}, episodesTotal: 10 }, { signal: controller.signal });
    await promise;
    const run = await store.getRun(id);
    assert.equal(run?.status, "failed");
    assert.equal(run?.error, "shutdown");
    assert.equal(workers.length, 0);
  });
});

describe("brainFitsLimit", () => {
  it("accepts small brains and rejects oversized ones", () => {
    assert.equal(brainFitsLimit({ q: [1, 2, 3] }), true);
    assert.equal(brainFitsLimit({ q: new Array(4_000_000).fill(0) }), false);   // about 8 MB of JSON
  });
});

describe("shortMessage", () => {
  it("keeps the first line, hides paths and caps the length", () => {
    const unix = shortMessage("Cannot find module '/app/src/lib/x.ts'\n    at foo (/app/src/y.ts:1:1)");
    assert.equal(unix, "Cannot find module '<path>'");
    assert.ok(!unix.includes("/app"));
    const win = shortMessage("Cannot find module 'C:\\app\\src\\x.ts'");
    assert.ok(!win.includes("app"), win);
    assert.equal(shortMessage("x".repeat(500)).length, 200);
  });
});
