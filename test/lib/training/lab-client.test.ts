import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createRun, fetchBaseline, getRunDetail, listRuns, parseBaseline } from "../../../src/lib/training/lab-client.ts";
import type { FetchFn } from "../../../src/lib/training/lab-client.ts";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): FetchFn => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const request = { game: "snake", algorithm: "q-learning", episodes: 10, params: { alpha: 0.1 } };
const summary = { id: 3, game: "snake", algorithm: "q-learning", status: "running", episodesDone: 5, episodesTotal: 10, createdAt: "2026-01-01T00:00:00.000Z", finishedAt: null, error: null, eval: null };

describe("createRun", () => {
  it("201 gives the id and sends a JSON body", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const result = await createRun(async (url, init) => { seen = { url, init }; return new Response('{"id":7}', { status: 201 }); }, request);
    assert.deepEqual(result, { ok: true, data: { id: 7 } });
    assert.equal(seen!.url, "/api/training/runs");   // non-null: set by the call above
    assert.equal(seen!.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(seen!.init?.body)), request);
  });

  it("maps 400 with a field, 429 with Retry-After, 404 disabled", async () => {
    assert.deepEqual(await createRun(reply(400, { error: "invalid_field", field: "episodes" }), request), { ok: false, kind: "invalid_field", field: "episodes" });
    assert.deepEqual(await createRun(reply(429, { error: "client_limit", retryAfterSeconds: 3600 }, { "Retry-After": "120" }), request), { ok: false, kind: "client_limit", retryAfterSeconds: 120 });
    assert.deepEqual(await createRun(reply(404, { error: "training_disabled" }), request), { ok: false, kind: "disabled" });
  });

  it("network errors, non-JSON and malformed bodies become typed failures, never throw", async () => {
    assert.deepEqual(await createRun(async () => { throw new TypeError("fetch failed"); }, request), { ok: false, kind: "network" });
    assert.deepEqual(await createRun(reply(500, "<html>oops</html>"), request), { ok: false, kind: "server_error" });
  });

  it("a 201 with an unreadable body is still a success (the run exists): id is null", async () => {
    for (const body of ["not json", { id: "x" }, { id: -1 }, {}]) {
      assert.deepEqual(await createRun(reply(201, body), request), { ok: true, data: { id: null } });
    }
  });

  it("an abort while the body is being read is 'aborted', not server_error", async () => {
    const controller = new AbortController();
    const fetchFn: FetchFn = async () => {
      const response = new Response("{}", { status: 500 });
      controller.abort();
      return Object.assign(response, { json: async () => { throw new DOMException("aborted", "AbortError"); } });
    };
    assert.deepEqual(await listRuns(fetchFn, 20, controller.signal), { ok: false, kind: "aborted" });
    assert.deepEqual(await createRun(fetchFn, request, controller.signal), { ok: false, kind: "aborted" });
  });

  it("maps a 403 forbidden_origin", async () => {
    assert.deepEqual(await createRun(reply(403, { error: "forbidden_origin" }), request), { ok: false, kind: "forbidden_origin" });
  });

  it("reports an aborted request as aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await createRun(async () => { throw new DOMException("aborted", "AbortError"); }, request, controller.signal);
    assert.deepEqual(result, { ok: false, kind: "aborted" });
  });
});

describe("listRuns", () => {
  it("parses runs and drops malformed entries", async () => {
    const result = await listRuns(reply(200, { runs: [summary, { id: "x" }, null, { ...summary, status: "weird" }] }), 20);
    assert.ok(result.ok);
    assert.deepEqual(result.data.map((r) => r.id), [3]);
  });

  it("rejects absurd numbers (|v| > 1e9): the item is dropped", async () => {
    const huge = { ...summary, id: 4, episodesDone: 1e300 };
    const result = await listRuns(reply(200, { runs: [summary, huge] }), 20);
    assert.ok(result.ok);
    assert.deepEqual(result.data.map((r) => r.id), [3]);
    const detail = await getRunDetail(reply(200, { ...summary, metrics: [{ episode: 1, avg: 1e308, best: 2, loss: null }, { episode: 2, avg: 1, best: 2, loss: null }] }), 3);
    assert.ok(detail.ok);
    assert.equal(detail.data.metrics.length, 1);
  });

  it("malformed shapes are failures", async () => {
    assert.equal((await listRuns(reply(200, { nope: 1 }), 20)).ok, false);
    assert.equal((await listRuns(reply(200, []), 20)).ok, false);
  });

  it("uses a safe limit in the URL", async () => {
    let url = "";
    await listRuns(async (u) => { url = u; return new Response('{"runs":[]}'); }, 9999);
    assert.equal(url, "/api/training/runs?limit=20");
  });
});

describe("getRunDetail", () => {
  it("parses metrics and evaluation defensively", async () => {
    const body = { ...summary, status: "succeeded", params: { alpha: 0.1, evil: "x" }, metrics: [{ episode: 1, avg: 1, best: 2, loss: null }, { episode: "x" }], evaluation: { overall: 3, variants: [{ label: "g", avg: 1, best: 2 }] } };
    const result = await getRunDetail(reply(200, body), 3);
    assert.ok(result.ok);
    assert.deepEqual(result.data.params, { alpha: 0.1 });
    assert.equal(result.data.metrics.length, 1);
    assert.equal(result.data.evaluation?.overall, 3);
    const broken = await getRunDetail(reply(200, { ...summary, evaluation: { overall: 3, variants: [{ label: 5 }] } }), 3);
    assert.ok(broken.ok && broken.data.evaluation === null);
  });

  it("never puts an invalid id in a URL", async () => {
    let called = false;
    const spy: FetchFn = async () => { called = true; return new Response("{}"); };
    for (const id of [0, -1, 1.5, NaN, 1e21, 12345678901234567890]) {
      assert.deepEqual(await getRunDetail(spy, id), { ok: false, kind: "not_found" });
    }
    assert.equal(called, false);
  });

  it("404 is not_found", async () => {
    assert.deepEqual(await getRunDetail(reply(404, { error: "not_found" }), 3), { ok: false, kind: "not_found" });
  });
});

describe("baseline", () => {
  const file = { brains: [{ algorithm: "q-learning", featuresVersion: 2, episodes: 25000, overall: 70, variants: [{ label: "g", avg: 1, best: 2, median: 1, games: 100 }] }] };

  it("parses the committed shape and ignores broken entries", () => {
    assert.equal(parseBaseline(file)?.[0].evaluation.overall, 70);
    assert.deepEqual(parseBaseline({ brains: [{ algorithm: "x" }, 5] }), []);
    assert.equal(parseBaseline({}), null);
    assert.equal(parseBaseline(null), null);
  });

  it("a 404, bad JSON or a network error just means no baseline", async () => {
    assert.equal(await fetchBaseline(reply(404, "")), null);
    assert.equal(await fetchBaseline(reply(200, "not json")), null);
    assert.equal(await fetchBaseline(async () => { throw new Error("down"); }), null);
    assert.equal((await fetchBaseline(reply(200, file)))?.length, 1);
  });
});
