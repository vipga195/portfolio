import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ApiResult } from "../../../src/lib/training/lab-client.ts";
import type { ReadGate, RunDetail, RunStatus, RunSummary } from "../../../src/lib/training/lab-model.ts";
import { createCompareFetcher, createDetailPoller, createListPoller } from "../../../src/lib/training/pollers.ts";
import type { Clock, ListState, ReadError } from "../../../src/lib/training/pollers.ts";

class FakeClock implements Clock {
  time = 1_000_000;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now(): number { return this.time; }
  setTimer(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ at: this.time + ms, fn, id });
    return id;
  }
  clearTimer(handle: unknown): void { this.timers = this.timers.filter((t) => t.id !== handle); }
  pending(): number { return this.timers.length; }
  // Advances fake time, firing timers in order and letting promises settle after each one
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.time = Math.max(this.time, next.at);
      next.fn();
      await settle();
    }
    this.time = end;
    // Chained requests (one after the other) need several turns to settle
    for (let i = 0; i < 8; i++) await settle();
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const run = (id: number, status: RunStatus = "succeeded"): RunSummary => ({
  id, game: "snake", algorithm: "q-learning", status, episodesDone: 0, episodesTotal: 10, createdAt: "2026-01-01T00:00:00.000Z", finishedAt: null, error: null, evalOverall: null,
});
const detail = (id: number, status: RunStatus = "succeeded"): RunDetail => ({ ...run(id, status), params: {}, metrics: [], evaluation: status === "succeeded" ? { variants: [], overall: 1 } : null });
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = (kind: ReadError["kind"], retryAfterSeconds?: number): ApiResult<never> => ({ ok: false, kind, retryAfterSeconds });

describe("list poller", () => {
  it("polls at the active pace, bases it on the latest window only, and stops fast polling when nothing is active", async () => {
    const clock = new FakeClock();
    const times: number[] = [];
    let window: RunSummary[] = [run(5, "running"), run(4)];
    const states: ListState[] = [];
    const poller = createListPoller({
      clock, gate: { blockedUntil: 0 },
      fetchList: async () => { times.push(clock.now()); return ok(window); },
      fetchDetail: async (id) => ok(detail(id)),
      onChange: (s) => states.push(s),
    });
    poller.start();
    await clock.advance(10_000);
    assert.deepEqual(times.slice(1).map((t, i) => t - times[i]), [3000, 3000, 3000]);
    window = [run(5), run(4)];   // everything finished
    await clock.advance(4000);
    assert.equal(poller.hasActive(), false);
    const before = times.length;
    await clock.advance(10_000);
    assert.equal(times.length - before, 1);   // now one request per 10 s
    poller.stop();
  });

  it("an active run that fell out of the window is fetched once, and no longer forces fast polling", async () => {
    const clock = new FakeClock();
    let window: RunSummary[] = [run(5, "running"), run(4)];
    const detailCalls: number[] = [];
    let last: ListState | null = null;
    const poller = createListPoller({
      clock, gate: { blockedUntil: 0 },
      fetchList: async () => ok(window),
      fetchDetail: async (id) => { detailCalls.push(id); return ok(detail(id)); },
      onChange: (s) => { last = s; },
    });
    poller.start();
    await clock.advance(100);
    window = [run(30), run(29)];   // run 5 is no longer in the top window
    await clock.advance(10_000);
    assert.deepEqual(detailCalls, [5]);
    assert.equal(poller.hasActive(), false);
    assert.equal(last!.runs?.find((r) => r.id === 5)?.status, "succeeded");   // non-null: onChange ran
    poller.stop();
  });

  it("after creating a run the next poll comes at the active pace, not the idle one", async () => {
    const clock = new FakeClock();
    const times: number[] = [];
    const poller = createListPoller({
      clock, gate: { blockedUntil: 0 },
      fetchList: async () => { times.push(clock.now()); return ok([run(1)]); },
      fetchDetail: async (id) => ok(detail(id)),
      onChange: () => undefined,
    });
    poller.start();
    await clock.advance(100);
    const start = clock.now();
    poller.refreshSoon();
    await clock.advance(3500);
    assert.ok(times.length >= 2 && times[1] - start <= 3000, `${times.join()}`);
    poller.stop();
  });

  it("an aborted request that settles late cannot apply or cause overlap; tab hide/show cannot raise the rate", async () => {
    const clock = new FakeClock();
    let calls = 0;
    const resolvers: ((r: ApiResult<RunSummary[]>) => void)[] = [];
    const states: ListState[] = [];
    const poller = createListPoller({
      clock, gate: { blockedUntil: 0 },
      fetchList: () => { calls++; return new Promise((resolve) => resolvers.push(resolve)); },
      fetchDetail: async (id) => ok(detail(id)),
      onChange: (s) => states.push(s),
    });
    poller.start();
    await clock.advance(0);
    assert.equal(calls, 1);
    poller.setVisible(false);
    resolvers[0](ok([run(99)]));   // settles after the abort
    await settle();
    assert.equal(states.length, 0, "late result ignored");
    for (let i = 0; i < 10; i++) {
      poller.setVisible(true);
      await clock.advance(200);
      poller.setVisible(false);
      await clock.advance(200);
    }
    assert.ok(calls <= 2, `calls: ${calls}`);
    poller.stop();
  });

  it("a 429 blocks the next request until Retry-After has passed", async () => {
    const clock = new FakeClock();
    const gate: ReadGate = { blockedUntil: 0 };
    const times: number[] = [];
    let first = true;
    const poller = createListPoller({
      clock, gate,
      fetchList: async () => { times.push(clock.now()); if (first) { first = false; return fail("rate_limited", 40); } return ok([run(1)]); },
      fetchDetail: async (id) => ok(detail(id)),
      onChange: () => undefined,
    });
    poller.start();
    await clock.advance(60_000);
    assert.ok(times[1] - times[0] >= 40_000, `${times.join()}`);
    poller.stop();
  });
});

describe("detail poller", () => {
  const make = (statuses: RunStatus[]) => {
    const clock = new FakeClock();
    const calls: number[] = [];
    const errors: (ReadError | null)[] = [];
    let i = 0;
    const poller = createDetailPoller({
      clock, gate: { blockedUntil: 0 },
      fetchDetail: async (id) => { calls.push(clock.now()); const status = statuses[Math.min(i++, statuses.length - 1)]; return id === 404 ? fail("not_found") : ok(detail(id, status)); },
      onDetail: () => undefined,
      onError: (_id, e) => errors.push(e),
      isFinishedCached: () => false,
    });
    return { clock, calls, errors, poller };
  };

  it("polls while running and stops after the final (finished) fetch", async () => {
    const { clock, calls, poller } = make(["running", "running", "succeeded"]);
    poller.select(7, "running");
    await clock.advance(30_000);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.slice(1).map((t, i) => t - calls[i]), [5000, 5000]);
    poller.stop();
  });

  it("stops on not_found", async () => {
    const { clock, calls, errors, poller } = make(["running"]);
    poller.select(404, undefined);
    await clock.advance(60_000);
    assert.equal(calls.length, 1);
    assert.equal(errors.at(-1)?.kind, "not_found");
    poller.stop();
  });

  it("a finished run seen in the list triggers one final fetch", async () => {
    const { clock, calls, poller } = make(["running", "succeeded"]);
    poller.select(7, "running");
    await clock.advance(1000);
    assert.equal(calls.length, 1);
    poller.select(7, "succeeded");
    await clock.advance(6000);
    assert.equal(calls.length, 2);
    await clock.advance(60_000);
    assert.equal(calls.length, 2);
    poller.stop();
  });
});

describe("compare fetcher", () => {
  const setup = (handler: (id: number, call: number) => ApiResult<RunDetail>) => {
    const clock = new FakeClock();
    const gate: ReadGate = { blockedUntil: 0 };
    const calls: { id: number; at: number }[] = [];
    const cached = new Set<number>();
    const failed: Record<number, ReadError | null> = {};
    const signals = new Map<number, AbortSignal>();
    let inflight = 0;
    let maxInflight = 0;
    const perId = new Map<number, number>();
    const fetcher = createCompareFetcher({
      clock, gate,
      fetchDetail: async (id, signal) => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        calls.push({ id, at: clock.now() });
        signals.set(id, signal);
        const n = (perId.get(id) ?? 0) + 1;
        perId.set(id, n);
        await settle();
        inflight--;
        return signal.aborted ? { ok: false, kind: "aborted" } : handler(id, n);
      },
      onDetail: (d) => cached.add(d.id),
      onFailed: (id, error) => { failed[id] = error; },
      isCached: (id) => cached.has(id),
    });
    return { clock, gate, calls, cached, failed, fetcher, signals, max: () => maxInflight };
  };

  it("fetches each uncached id exactly once, sequentially; re-selecting does not re-send", async () => {
    const { clock, calls, fetcher, max } = setup((id) => ok(detail(id)));
    fetcher.setSelected([3, 2, 1]);
    await clock.advance(1000);
    assert.deepEqual(calls.map((c) => c.id), [3, 2, 1]);
    assert.equal(max(), 1);
    fetcher.setSelected([3, 2, 1, 4]);
    await clock.advance(1000);
    fetcher.setSelected([3, 1, 4]);
    await clock.advance(1000);
    assert.deepEqual(calls.map((c) => c.id), [3, 2, 1, 4]);
    fetcher.destroy();
  });

  it("deselecting aborts only that id's request", async () => {
    const { clock, fetcher, signals } = setup((id) => ok(detail(id)));
    fetcher.setSelected([1, 2]);
    await Promise.resolve();
    fetcher.setSelected([2]);
    assert.equal(signals.get(1)?.aborted, true);
    assert.notEqual(signals.get(2)?.aborted, true);
    await clock.advance(1000);
    fetcher.destroy();
  });

  it("a 429 blocks everything until Retry-After and the table is not left empty afterwards", async () => {
    const { clock, calls, cached, fetcher, gate } = setup((id, n) => (id === 1 && n === 1 ? fail("rate_limited", 30) : ok(detail(id))));
    fetcher.setSelected([1, 2]);
    await clock.advance(1000);
    assert.equal(calls.length, 1);
    assert.ok(gate.blockedUntil > clock.now());
    await clock.advance(29_000);
    assert.equal(calls.length, 1);
    await clock.advance(5000);
    assert.deepEqual([...cached].sort(), [1, 2]);
    assert.deepEqual(calls.map((c) => c.id), [1, 1, 2]);
    fetcher.destroy();
  });

  it("other failures retry with backoff 4/8 s and give up after 3 attempts with a per-row error; retry() starts over", async () => {
    let allow = false;
    const { clock, calls, failed, fetcher } = setup((id) => (allow ? ok(detail(id)) : fail("server_error")));
    fetcher.setSelected([5]);
    await clock.advance(1000);
    assert.equal(calls.length, 1);
    await clock.advance(4000);
    assert.equal(calls.length, 2);
    await clock.advance(8000);
    assert.equal(calls.length, 3);
    await clock.advance(60_000);
    assert.equal(calls.length, 3);
    assert.equal(failed[5]?.kind, "server_error");
    allow = true;
    fetcher.retry(5);
    await clock.advance(1000);
    assert.equal(calls.length, 4);
    assert.equal(failed[5], null);
    fetcher.destroy();
  });
});

describe("request budget simulation (5 minutes)", () => {
  it("one active selected run + 3 comparison runs + tab hide/show cycles + a 429 stay under the per-client read budget with margin", async () => {
    const clock = new FakeClock();
    const gate: ReadGate = { blockedUntil: 0 };
    const requests: number[] = [];
    const perCompareId = new Map<number, number>();
    const cached = new Set<number>();
    let rateLimitOnce = true;
    const maybe429 = (): ApiResult<never> | null => {
      if (rateLimitOnce && clock.now() >= 1_000_000 + 150_000) {
        rateLimitOnce = false;
        return fail("rate_limited", 20);
      }
      return null;
    };
    const fetchDetail = async (id: number): Promise<ApiResult<RunDetail>> => {
      requests.push(clock.now());
      if (id !== 10) perCompareId.set(id, (perCompareId.get(id) ?? 0) + 1);
      return maybe429() ?? ok(detail(id, id === 10 ? "running" : "succeeded"));
    };
    const list = createListPoller({
      clock, gate,
      fetchList: async () => { requests.push(clock.now()); return maybe429() ?? ok([run(10, "running"), run(9), run(8), run(7)]); },
      fetchDetail, onChange: () => undefined,
    });
    const detailPoller = createDetailPoller({ clock, gate, fetchDetail, onDetail: () => undefined, onError: () => undefined, isFinishedCached: () => false });
    const compare = createCompareFetcher({ clock, gate, fetchDetail, onDetail: (d) => cached.add(d.id), onFailed: () => undefined, isCached: (id) => cached.has(id) });
    const setVisible = (v: boolean): void => { list.setVisible(v); detailPoller.setVisible(v); compare.setVisible(v); };

    list.start();
    detailPoller.select(10, "running");
    compare.setSelected([9, 8, 7]);
    const start = clock.now();
    for (let t = 0; t < 300_000; t += 250) {
      // Hidden for 20 s at 60 s, rapid hide/show flapping from 120 s, then another hidden stretch
      const at = t / 1000;
      if (t === 60_000) setVisible(false);
      if (t === 80_000) setVisible(true);
      if (at >= 120 && at < 125 && t % 500 === 0) setVisible(t % 1000 === 0);
      if (t === 125_000) setVisible(true);
      await clock.advance(250);
    }
    list.stop();
    detailPoller.stop();
    compare.destroy();

    assert.equal(clock.now() - start, 300_000);
    for (const id of [9, 8, 7]) assert.equal(perCompareId.get(id), 1, `compare run ${id} requested once`);
    let peak = 0;
    for (const t of requests) peak = Math.max(peak, requests.filter((r) => r >= t && r < t + 60_000).length);
    console.log(`simulation: ${requests.length} read requests in 5 min, peak ${peak} per 60 s window`);
    assert.ok(peak <= 50, `peak ${peak} per 60 s`);
  });
});
