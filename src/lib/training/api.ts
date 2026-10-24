// Public training API as plain functions (request, deps) -> Response, so they can be unit-tested without Next.js.
// The route files in src/app/api/training only wire real dependencies and call these.
import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { parseEpisodes } from "../ai/algorithm.ts";
import type { AlgorithmId } from "../ai/algorithm.ts";
import { SITE_URL } from "../site.ts";
import { getAlgorithm, getGame } from "../registry.ts";
import type { JobStore, RunMetric, TrainingRun } from "./jobs.ts";
import type { Limiter } from "./limiter.ts";
import { MAX_BODY_BYTES } from "./public-config.ts";
import type { PublicApiConfig } from "./public-config.ts";

export type ApiDeps = {
  store: JobStore;
  // Feature flag and limits (see public-config.ts)
  config: PublicApiConfig;
  // Bounded in-memory request budgets (per client key and global)
  limiter: Limiter;
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const MAX_METRICS = 100;
const RUN_ID = /^[1-9][0-9]{0,15}$/;
const TOP_LEVEL_KEYS = ["game", "algorithm", "episodes", "params"];
const REQUIRED_REPRESENTATION: Record<AlgorithmId, "tabular" | "dense"> = { "q-learning": "tabular", dqn: "dense" };

const CACHE_SHORT = "public, max-age=2, s-maxage=2, stale-while-revalidate=5";
const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
const NO_STORE = "no-store";

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": NO_STORE, ...headers } });
}

function disabled(): Response {
  return json({ error: "training_disabled" }, 404);
}

function serverError(error: unknown): Response {
  // Internals stay in the server log
  console.error("training api error:", error);
  return json({ error: "server_error" }, 500);
}

// IPv6 text -> 8 hextets (handles "::" and an embedded IPv4 tail)
function expandIpv6(address: string): number[] {
  let text = address;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const [a, b, c, d] = tail.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::");
  const front = head === "" ? [] : head.split(":");
  const back = rest === undefined || rest === "" ? [] : rest.split(":");
  const fill = rest === undefined ? 0 : 8 - front.length - back.length;
  return [...front, ...Array<string>(fill).fill("0"), ...back].map((part) => parseInt(part, 16));
}

// Behind Cloudflare the client address is in cf-connecting-ip. x-forwarded-for is client-controlled, so it is not used.
// Canonical key: IPv4 as is; IPv4-mapped IPv6 unmapped to IPv4; other IPv6 reduced to its /64 (one subscriber owns a whole /64).
export function clientKeyFromRequest(request: Request): string {
  const value = request.headers.get("cf-connecting-ip")?.trim();
  if (!value || isIP(value) === 0) return "unknown";
  const address = value.split("%")[0];
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return "unknown";
  const hextets = expandIpv6(address);
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    return `${hextets[6] >> 8}.${hextets[6] & 255}.${hextets[7] >> 8}.${hextets[7] & 255}`;
  }
  return `${hextets.slice(0, 4).map((h) => h.toString(16).padStart(4, "0")).join(":")}::/64`;
}

// Privacy: an unsalted SHA-256 of an IPv4 address can be brute-forced (only 2^32 inputs). Set TRAINING_IP_SALT to mix a secret in.
export function hashClientKey(key: string, salt: string | null): string {
  return createHash("sha256").update(salt ? `${salt}:${key}` : key).digest("hex");
}

// ---- public shapes (field-by-field allowlist: never spread a database row) ----

export type PublicRun = {
  id: number;
  game: string;
  algorithm: string;
  status: string;
  episodesDone: number;
  episodesTotal: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  eval: { overall: number } | null;
};

export function toPublicRun(run: TrainingRun, evalOverall: number | null): PublicRun {
  return {
    id: run.id,
    game: run.game,
    algorithm: run.algorithm,
    status: run.status,
    episodesDone: run.episodesDone,
    episodesTotal: run.episodesTotal,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    error: run.error,
    eval: run.status === "succeeded" && evalOverall !== null ? { overall: evalOverall } : null,
  };
}

function thin(metrics: RunMetric[]): RunMetric[] {
  if (metrics.length <= MAX_METRICS) return metrics;
  const last = metrics.length - 1;
  return Array.from({ length: MAX_METRICS }, (_, i) => metrics[Math.round((i * last) / (MAX_METRICS - 1))]);
}

// ---- POST /api/training/runs ----

const TOO_LARGE: unique symbol = Symbol("too_large");

async function readBody(request: Request): Promise<string | typeof TOO_LARGE> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return TOO_LARGE;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return origin === new URL(request.url).origin || origin === new URL(SITE_URL).origin;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MINUTE_MS = 60_000;

// One atomic check of the per-client and the global budget: a denied request charges neither
function throttled(deps: ApiDeps, kind: "post" | "read" | "brain", clientKey: string): Response | null {
  const { rates } = deps.config;
  const rules = {
    post: { client: { max: rates.postPerClient, windowMs: 10 * MINUTE_MS }, global: { max: rates.postGlobal, windowMs: MINUTE_MS } },
    read: { client: { max: rates.readPerClient, windowMs: MINUTE_MS }, global: { max: rates.readGlobal, windowMs: MINUTE_MS } },
    brain: { client: { max: rates.brainPerClient, windowMs: MINUTE_MS }, global: { max: rates.brainGlobal, windowMs: MINUTE_MS } },
  }[kind];
  const result = deps.limiter.consume({ key: `${kind}:client:${clientKey}`, rule: rules.client }, { name: `${kind}:global`, rule: rules.global });
  if (result.allowed) return null;
  return json({ error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds }, 429, { "Retry-After": String(result.retryAfterSeconds) });
}

export async function createRun(request: Request, deps: ApiDeps): Promise<Response> {
  if (!deps.config.enabled) return disabled();
  try {
    // Same-origin check: this only stops cross-site browser abuse of an anonymous public API, not direct callers
    if (!originAllowed(request)) return json({ error: "forbidden_origin" }, 403);
    const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") return json({ error: "unsupported_media_type" }, 415);
    const declared = request.headers.get("content-length");
    if (declared !== null && Number(declared) > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

    const clientKey = clientKeyFromRequest(request);
    const limited = throttled(deps, "post", clientKey);
    if (limited) return limited;

    const text = await readBody(request);
    if (text === TOO_LARGE) return json({ error: "payload_too_large" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "invalid_body" }, 400);
    }
    if (!isRecord(body) || !Object.keys(body).every((key) => TOP_LEVEL_KEYS.includes(key))) return json({ error: "invalid_body" }, 400);

    const game = typeof body.game === "string" ? getGame(body.game) : undefined;
    if (!game) return json({ error: "invalid_field", field: "game" }, 400);
    const algorithm = typeof body.algorithm === "string" ? getAlgorithm(body.algorithm) : undefined;
    if (!algorithm) return json({ error: "invalid_field", field: "algorithm" }, 400);
    // The algorithm trains on one representation of the game; reject a pair that would only fail later in the worker
    if (!game[REQUIRED_REPRESENTATION[algorithm.id]]) return json({ error: "invalid_field", field: "algorithm" }, 400);
    const episodes = parseEpisodes(algorithm, body.episodes);
    if (episodes === null) return json({ error: "invalid_field", field: "episodes" }, 400);
    const params = algorithm.parseParams(Object.hasOwn(body, "params") ? body.params : {});
    if (params === null) return json({ error: "invalid_field", field: "params" }, 400);

    const result = await deps.store.enqueueWithQuota(
      { game: game.id, algorithm: algorithm.id, params, episodesTotal: episodes, trusted: false, ipHash: hashClientKey(clientKey, deps.config.ipSalt) },
      deps.config.limits,
    );
    if (!result.ok) {
      const retryAfterSeconds = result.reason === "queue_full" ? 60 : 3600;
      return json({ error: result.reason, retryAfterSeconds }, 429, { "Retry-After": String(retryAfterSeconds) });
    }
    return json({ id: result.run.id }, 201);
  } catch (error) {
    return serverError(error);
  }
}

// ---- GET handlers ----

export async function listRuns(request: Request, deps: ApiDeps): Promise<Response> {
  if (!deps.config.enabled) return disabled();
  try {
    const limited = throttled(deps, "read", clientKeyFromRequest(request));
    if (limited) return limited;
    const raw = new URL(request.url).searchParams.get("limit");
    let limit = DEFAULT_LIST_LIMIT;
    if (raw !== null) {
      limit = /^[0-9]{1,3}$/.test(raw) ? Number(raw) : NaN;
      if (!(limit >= 1 && limit <= MAX_LIST_LIMIT)) return json({ error: "invalid_field", field: "limit" }, 400);
    }
    const listed = await deps.store.listPublicRuns(limit);
    return json({ runs: listed.map(({ run, evalOverall }) => toPublicRun(run, evalOverall)) }, 200, { "Cache-Control": CACHE_SHORT });
  } catch (error) {
    return serverError(error);
  }
}

function parseRunId(raw: string): number | null {
  return RUN_ID.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

export async function getRunDetail(request: Request, rawId: string, deps: ApiDeps): Promise<Response> {
  if (!deps.config.enabled) return disabled();
  try {
    const limited = throttled(deps, "read", clientKeyFromRequest(request));
    if (limited) return limited;
    const id = parseRunId(rawId);
    const run = id === null ? null : await deps.store.getRun(id);
    // Trusted (owner/CLI) runs look exactly like missing ones
    if (id === null || !run || run.trusted) return json({ error: "not_found" }, 404);
    const evaluation = run.status === "succeeded" ? await deps.store.getEval(id) : null;
    const overall = isRecord(evaluation) && typeof evaluation.overall === "number" ? evaluation.overall : null;
    const metrics = thin(await deps.store.getMetrics(id));
    const body = { ...toPublicRun(run, overall), params: run.params, evaluation, metrics };
    return json(body, 200, { "Cache-Control": CACHE_SHORT });
  } catch (error) {
    return serverError(error);
  }
}

export async function getRunBrain(request: Request, rawId: string, deps: ApiDeps): Promise<Response> {
  if (!deps.config.enabled) return disabled();
  try {
    const limited = throttled(deps, "brain", clientKeyFromRequest(request));
    if (limited) return limited;
    const id = parseRunId(rawId);
    const run = id === null ? null : await deps.store.getRun(id);
    if (id === null || !run || run.trusted || run.status !== "succeeded") return json({ error: "not_found" }, 404);
    // The stored JSON text is served as is: no parse and re-stringify on the request path
    const text = await deps.store.getBrainText(id);
    if (text === null) return json({ error: "not_found" }, 404);
    // A succeeded run never changes, so its brain can be cached forever
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": CACHE_IMMUTABLE } });
  } catch (error) {
    return serverError(error);
  }
}
