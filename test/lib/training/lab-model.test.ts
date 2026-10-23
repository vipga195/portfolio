import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildComparison, buildCurve, errorKind, formatNumber, humanizeDuration, mergeRuns, nextPollDelayMs, parseGridSize, pickInitialSelection, pickNextToFetch, retryDelayMs, shouldRefreshNow, toSummary, validateForm, vanishedActiveIds } from "../../../src/lib/training/lab-model.ts";
import type { CompareEntry, RunSummary } from "../../../src/lib/training/lab-model.ts";

const BOX = { width: 400, height: 200, left: 40, right: 10, top: 10, bottom: 30 };
const run = (id: number, status: RunSummary["status"] = "queued"): RunSummary => ({
  id, game: "snake", algorithm: "q-learning", status, episodesDone: 0, episodesTotal: 10, createdAt: "2026-01-01T00:00:00.000Z", finishedAt: null, error: null, evalOverall: null,
});

describe("nextPollDelayMs", () => {
  it("2s-class when active, slow when idle, backoff on errors, none when hidden", () => {
    const base = { hasActive: false, consecutiveErrors: 0, hidden: false };
    assert.equal(nextPollDelayMs({ ...base, hasActive: true }), 3000);
    assert.equal(nextPollDelayMs(base), 10_000);
    assert.equal(nextPollDelayMs({ ...base, hidden: true, hasActive: true }), null);
    assert.equal(nextPollDelayMs({ ...base, consecutiveErrors: 1 }), 4000);
    assert.equal(nextPollDelayMs({ ...base, consecutiveErrors: 2 }), 8000);
    assert.equal(nextPollDelayMs({ ...base, consecutiveErrors: 10 }), 30_000);
  });

  it("one open tab plus a selected running run stays under the default read budget of 60/min", () => {
    const perMinute = 60_000 / 3000 + 60_000 / 5000;
    assert.ok(perMinute <= 40, String(perMinute));
  });
});

describe("mergeRuns window, cap and stale active runs", () => {
  it("caps the merged list by dropping the oldest finished runs, never active ones", () => {
    const many = Array.from({ length: 60 }, (_, i) => run(i + 1, i === 0 ? "running" : "succeeded"));
    const merged = mergeRuns([], many, 50);
    assert.equal(merged.length, 50);
    assert.ok(merged.some((r) => r.id === 1), "the old but active run stays");
    assert.ok(!merged.some((r) => r.id === 2), "the oldest finished run is dropped");
    assert.equal(merged[0].id, 60);
  });

  it("finds active runs that fell out of the latest window", () => {
    const previous = [run(9, "running"), run(5, "running"), run(4, "succeeded")];
    const latest = [run(12, "queued"), run(9, "running"), run(8, "succeeded")];
    assert.deepEqual(vanishedActiveIds(previous, latest), [5]);
    assert.deepEqual(vanishedActiveIds([run(3, "running")], []), [3]);
    assert.deepEqual(vanishedActiveIds([], latest), []);
  });

  it("toSummary keeps the evaluation overall", () => {
    const summary = toSummary({ ...run(1, "succeeded"), params: {}, metrics: [], evaluation: { variants: [], overall: 4 } });
    assert.equal(summary.evalOverall, 4);
    assert.ok(!("metrics" in summary));
  });

  it("initial selection: active first, else newest succeeded, else null", () => {
    assert.equal(pickInitialSelection([run(3, "succeeded"), run(2, "running"), run(1, "succeeded")]), 2);
    assert.equal(pickInitialSelection([run(3, "failed"), run(2, "succeeded"), run(1, "succeeded")]), 2);
    assert.equal(pickInitialSelection([run(1, "failed")]), null);
    assert.equal(pickInitialSelection([]), null);
  });
});

describe("shouldRefreshNow", () => {
  it("never sooner than one interval after the last request, never before blockedUntil", () => {
    assert.deepEqual(shouldRefreshNow(10_000, 0, 0, 3000), { now: true, waitMs: 0 });
    assert.deepEqual(shouldRefreshNow(10_000, 9000, 0, 3000), { now: false, waitMs: 2000 });
    assert.deepEqual(shouldRefreshNow(10_000, 0, 25_000, 3000), { now: false, waitMs: 15_000 });
    assert.deepEqual(shouldRefreshNow(10_000, Number.NEGATIVE_INFINITY, 0, 3000), { now: true, waitMs: 0 });
  });
});

describe("pickNextToFetch", () => {
  const idle = { status: "idle", attempts: 0, retryAt: 0 } as const;

  it("fetches uncached ids one at a time, in order", () => {
    assert.deepEqual(pickNextToFetch([3, 2, 1], {}, 0, 100), { kind: "fetch", id: 3 });
    assert.deepEqual(pickNextToFetch([3, 2, 1], { 3: { status: "inflight", attempts: 0, retryAt: 0 } }, 0, 100), { kind: "idle" });
    assert.deepEqual(pickNextToFetch([3, 2, 1], { 3: { status: "done", attempts: 0, retryAt: 0 }, 2: idle }, 0, 100), { kind: "fetch", id: 2 });
    assert.deepEqual(pickNextToFetch([3], { 3: { status: "done", attempts: 0, retryAt: 0 } }, 0, 100), { kind: "idle" });
    assert.deepEqual(pickNextToFetch([], {}, 0, 100), { kind: "idle" });
  });

  it("waits for blockedUntil and for retry times, and gives up after 3 attempts", () => {
    assert.deepEqual(pickNextToFetch([1], {}, 5000, 1000), { kind: "wait", waitMs: 4000 });
    assert.deepEqual(pickNextToFetch([1], { 1: { status: "failed", attempts: 1, retryAt: 4000 } }, 0, 1000), { kind: "wait", waitMs: 3000 });
    assert.deepEqual(pickNextToFetch([1], { 1: { status: "failed", attempts: 1, retryAt: 4000 } }, 0, 4000), { kind: "fetch", id: 1 });
    assert.deepEqual(pickNextToFetch([1], { 1: { status: "failed", attempts: 3, retryAt: 0 } }, 0, 9999), { kind: "idle" });
    assert.deepEqual([1, 2, 3].map(retryDelayMs), [4000, 8000, 16_000]);
  });

  it("a ready id is fetched even if another one is still waiting", () => {
    assert.deepEqual(pickNextToFetch([1, 2], { 1: { status: "failed", attempts: 1, retryAt: 9000 } }, 0, 1000), { kind: "fetch", id: 2 });
  });
});

describe("formatting helpers", () => {
  it("formatNumber groups and limits fraction digits per locale", () => {
    assert.equal(formatNumber("en", 12345.678, 1), "12,345.7");
    assert.equal(formatNumber("en", 20000, 0), "20,000");
    assert.equal(formatNumber("vi", 1234.5, 1), "1.234,5");
  });

  it("humanizeDuration thresholds", () => {
    assert.deepEqual(humanizeDuration(0), { unit: "seconds", value: 1 });
    assert.deepEqual(humanizeDuration(89), { unit: "seconds", value: 89 });
    assert.deepEqual(humanizeDuration(90), { unit: "minutes", value: 2 });
    assert.deepEqual(humanizeDuration(3600), { unit: "minutes", value: 60 });
    assert.deepEqual(humanizeDuration(5400), { unit: "hours", value: 2 });
  });

  it("parseGridSize extracts the size or gives null", () => {
    assert.equal(parseGridSize("grid 8x8"), 8);
    assert.equal(parseGridSize("Grid 40x40"), 40);
    assert.equal(parseGridSize("grid 8x9"), null);
    assert.equal(parseGridSize("custom"), null);
    assert.equal(parseGridSize(""), null);
  });
});

describe("errorKind forbidden_origin", () => {
  it("maps the origin check", () => {
    assert.deepEqual(errorKind(403, { error: "forbidden_origin" }), { kind: "forbidden_origin" });
    assert.deepEqual(errorKind(403, null), { kind: "forbidden_origin" });
  });
});

describe("mergeRuns", () => {
  it("merges by id, incoming wins, newest first", () => {
    const merged = mergeRuns([run(1), run(2)], [run(2, "running"), run(3)]);
    assert.deepEqual(merged.map((r) => r.id), [3, 2, 1]);
    assert.equal(merged[1].status, "running");
    assert.deepEqual(mergeRuns([], []), []);
  });
});

describe("buildCurve", () => {
  it("handles 0, 1 and many points", () => {
    assert.equal(buildCurve([], BOX).pointCount, 0);
    const one = buildCurve([{ episode: 5, avg: 2, best: 3, loss: null }], BOX);
    assert.equal(one.pointCount, 1);
    assert.match(one.avgPath, /^M[\d.]+ [\d.]+$/);
    const many = buildCurve(Array.from({ length: 50 }, (_, i) => ({ episode: i + 1, avg: i, best: i * 2, loss: null })), BOX);
    assert.equal(many.pointCount, 50);
    assert.ok(many.xTicks.length >= 3 && many.yTicks.length >= 3);
    assert.ok(many.avgPoints.every((p) => p.x >= BOX.left && p.x <= BOX.width - BOX.right && p.y >= BOX.top && p.y <= BOX.height - BOX.bottom));
  });

  it("emits no NaN for huge or flat values", () => {
    const huge = buildCurve([{ episode: 1, avg: 1e308, best: 1e308, loss: null }, { episode: 2, avg: -1e308, best: 3, loss: null }, { episode: 3, avg: 1, best: 2, loss: null }], BOX);
    assert.equal(huge.pointCount, 1);
    for (const curve of [huge, buildCurve([{ episode: 7, avg: 5, best: 5, loss: null }], BOX), buildCurve([{ episode: 0, avg: 0, best: 0, loss: null }], BOX)]) {
      assert.ok(!/NaN|Infinity/.test(JSON.stringify(curve)), JSON.stringify(curve));
    }
  });

  it("uses integer Y ticks for integer scores, nice X ticks starting at 0", () => {
    const curve = buildCurve(Array.from({ length: 50 }, (_, i) => ({ episode: 2 + i * 2, avg: Math.floor(i / 3), best: Math.floor(i / 2) + 1, loss: null })), BOX);
    assert.ok(curve.yTicks.every((t) => /^\d+$/.test(t.label)), curve.yTicks.map((t) => t.label).join());
    assert.deepEqual(curve.xTicks.map((t) => t.label), ["0", "50", "100"]);
    const small = buildCurve([{ episode: 1, avg: 0, best: 1, loss: null }, { episode: 2, avg: 1, best: 2, loss: null }], BOX);
    assert.ok(small.yTicks.every((t) => /^\d+$/.test(t.label)));
    const fractional = buildCurve([{ episode: 1, avg: 0.2, best: 0.5, loss: null }, { episode: 2, avg: 0.4, best: 0.9, loss: null }], BOX);
    assert.ok(fractional.yTicks.some((t) => t.label.includes(".")));
  });

  it("flat series and non-finite values do not produce NaN", () => {
    const flat = buildCurve([{ episode: 1, avg: 0, best: 0, loss: null }, { episode: 2, avg: 0, best: 0, loss: null }], BOX);
    assert.ok(!/NaN|Infinity/.test(flat.avgPath + flat.bestPath + JSON.stringify(flat.yTicks)));
    const dirty = buildCurve(
      [{ episode: 1, avg: NaN, best: 1, loss: null }, { episode: 2, avg: 1, best: Infinity, loss: null }, { episode: 3, avg: 1, best: 2, loss: null }],
      BOX,
    );
    assert.equal(dirty.pointCount, 1);
    assert.ok(!/NaN|Infinity/.test(dirty.avgPath));
    const sameEpisode = buildCurve([{ episode: 4, avg: 1, best: 1, loss: null }, { episode: 4, avg: 2, best: 2, loss: null }], BOX);
    assert.ok(!/NaN/.test(sameEpisode.avgPath));
  });
});

describe("buildComparison", () => {
  const entry = (key: string, kind: "run" | "baseline", values: [number, number][], overall: number): CompareEntry => ({
    key, label: key, kind, evaluation: { variants: values.map(([avg, best], i) => ({ label: `g${i}`, avg, best })), overall },
  });

  it("flags the best value per column and overall, baseline first, skips missing evaluations", () => {
    const table = buildComparison(
      [entry("a", "run", [[10, 20], [5, 9]], 7.5), entry("b", "run", [[8, 30], [6, 8]], 7), { key: "c", label: "c", kind: "run", evaluation: null }],
      [entry("base", "baseline", [[9, 25], [4, 7]], 6.5)],
    );
    assert.deepEqual(table.columns, ["g0", "g1"]);
    assert.deepEqual(table.rows.map((r) => r.key), ["base", "a", "b"]);
    const [base, a, b] = table.rows;
    assert.equal(a.cells[0]?.avgIsBest, true);
    assert.equal(b.cells[0]?.bestIsBest, true);
    assert.equal(a.cells[0]?.bestIsBest, false);
    assert.equal(b.cells[1]?.avgIsBest, true);
    assert.equal(a.overallIsBest, true);
    assert.equal(base.overallIsBest, false);
  });

  it("empty input gives an empty table", () => {
    assert.deepEqual(buildComparison([], []), { columns: [], rows: [] });
  });
});

describe("errorKind", () => {
  it("maps API failures to dictionary keys", () => {
    assert.deepEqual(errorKind(0, null), { kind: "network" });
    assert.deepEqual(errorKind(404, { error: "training_disabled" }), { kind: "disabled" });
    assert.deepEqual(errorKind(404, { error: "not_found" }), { kind: "not_found" });
    assert.deepEqual(errorKind(400, { error: "invalid_field", field: "episodes" }), { kind: "invalid_field", field: "episodes" });
    assert.deepEqual(errorKind(400, { error: "invalid_body" }), { kind: "invalid_body" });
    assert.deepEqual(errorKind(413, {}), { kind: "invalid_body" });
    assert.deepEqual(errorKind(500, { error: "server_error" }), { kind: "server_error" });
    assert.deepEqual(errorKind(502, "<html>"), { kind: "server_error" });
    for (const kind of ["queue_full", "client_limit", "global_limit", "rate_limited"]) assert.equal(errorKind(429, { error: kind }).kind, kind);
    assert.equal(errorKind(429, null).kind, "rate_limited");
  });

  it("takes retryAfterSeconds from the header first, then the body, and ignores junk", () => {
    assert.equal(errorKind(429, { error: "rate_limited", retryAfterSeconds: 30 }, "12").retryAfterSeconds, 12);
    assert.equal(errorKind(429, { error: "rate_limited", retryAfterSeconds: 30 }, null).retryAfterSeconds, 30);
    assert.equal(errorKind(429, { error: "rate_limited", retryAfterSeconds: -1 }, "abc").retryAfterSeconds, undefined);
  });
});

describe("validateForm", () => {
  const good = { episodes: "100", params: { alpha: "0.1", gamma: "0.9", epsilonEnd: "0.02", exploreFraction: "0.6" } };

  it("accepts valid values and returns numbers", () => {
    const result = validateForm("q-learning", good);
    assert.ok(result.ok);
    assert.equal(result.episodes, 100);
    assert.equal(result.params.alpha, 0.1);
  });

  it("rejects NaN, empty, out of range, non-integer and too many episodes", () => {
    const bad = (overrides: Partial<typeof good>) => validateForm("q-learning", { ...good, ...overrides });
    const errors = (r: ReturnType<typeof bad>): Record<string, { code: string }> => (r.ok ? {} : r.errors);
    assert.equal(errors(bad({ episodes: "abc" })).episodes.code, "not_a_number");
    assert.equal(errors(bad({ episodes: "" })).episodes.code, "not_a_number");
    assert.equal(errors(bad({ episodes: "0" })).episodes.code, "out_of_range");
    assert.equal(errors(bad({ episodes: "20001" })).episodes.code, "out_of_range");
    assert.equal(errors(bad({ episodes: "10.5" })).episodes.code, "not_integer");
    assert.equal(errors(bad({ episodes: "Infinity" })).episodes.code, "not_a_number");
    assert.equal(errors(bad({ params: { ...good.params, alpha: "5" } })).alpha.code, "out_of_range");
    assert.equal(errors(bad({ params: { ...good.params, gamma: "" } })).gamma.code, "not_a_number");
    assert.equal(validateForm("dqn", { episodes: "5001", params: { lr: "0.001", gamma: "0.9", epsilonEnd: "0.05", exploreFraction: "0.6" } }).ok, false);
    assert.equal(validateForm("dqn", { episodes: "5000", params: { lr: "0.001", gamma: "0.9", epsilonEnd: "0.05", exploreFraction: "0.6" } }).ok, true);
  });

  it("a missing param is an error", () => {
    assert.equal(validateForm("q-learning", { episodes: "10", params: {} }).ok, false);
  });
});
