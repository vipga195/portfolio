// Browser-side client of the public training API. The fetch function is injected (tests use a fake).
// Defensive: it never throws into the UI. Every failure is a typed result, every response is shape-checked.
import { MAX_ABS_VALUE, errorKind } from "./lab-model.ts";
import type { ApiErrorInfo, Evaluation, Metric, RunDetail, RunStatus, RunSummary } from "./lab-model.ts";

export type BaselineBrain = { algorithm: string; featuresVersion: number | null; episodes: number | null; evaluation: Evaluation };

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiFailure = ApiErrorInfo & { ok: false } | { ok: false; kind: "aborted" };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

const RUN_ID = /^[1-9][0-9]{0,15}$/;
const STATUSES: readonly string[] = ["queued", "running", "succeeded", "failed", "cancelled"];
const BASE = "/api/training/runs";

export type NewRunRequest = { game: string; algorithm: string; episodes: number; params: Record<string, number> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_ABS_VALUE ? value : null;
}

function isStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && STATUSES.includes(value);
}

export function parseRunSummary(input: unknown): RunSummary | null {
  if (!isRecord(input)) return null;
  const id = num(input.id);
  const done = num(input.episodesDone);
  const total = num(input.episodesTotal);
  if (id === null || !Number.isInteger(id) || id < 1 || done === null || total === null) return null;
  if (typeof input.game !== "string" || typeof input.algorithm !== "string" || !isStatus(input.status) || typeof input.createdAt !== "string") return null;
  const overall = isRecord(input.eval) ? num(input.eval.overall) : null;
  return {
    id,
    game: input.game,
    algorithm: input.algorithm,
    status: input.status,
    episodesDone: done,
    episodesTotal: total,
    createdAt: input.createdAt,
    finishedAt: typeof input.finishedAt === "string" ? input.finishedAt : null,
    error: typeof input.error === "string" ? input.error : null,
    evalOverall: overall,
  };
}

function parseMetrics(input: unknown): Metric[] {
  if (!Array.isArray(input)) return [];
  const metrics: Metric[] = [];
  for (const item of input) {
    if (!isRecord(item)) continue;
    const episode = num(item.episode);
    const avg = num(item.avg);
    const best = num(item.best);
    if (episode !== null && avg !== null && best !== null) metrics.push({ episode, avg, best, loss: num(item.loss) });
  }
  return metrics;
}

export function parseEvaluation(input: unknown): Evaluation | null {
  if (!isRecord(input) || !Array.isArray(input.variants)) return null;
  const overall = num(input.overall);
  if (overall === null) return null;
  const variants = [];
  for (const item of input.variants) {
    if (!isRecord(item) || typeof item.label !== "string") return null;
    const avg = num(item.avg);
    const best = num(item.best);
    if (avg === null || best === null) return null;
    variants.push({ label: item.label, avg, best });
  }
  return { variants, overall };
}

function parseParams(input: unknown): Record<string, number> {
  const params: Record<string, number> = {};
  if (isRecord(input)) for (const [key, value] of Object.entries(input)) if (typeof value === "number" && Number.isFinite(value)) params[key] = value;
  return params;
}

export function parseRunDetail(input: unknown): RunDetail | null {
  const summary = parseRunSummary(input);
  if (!summary || !isRecord(input)) return null;
  return { ...summary, params: parseParams(input.params), metrics: parseMetrics(input.metrics), evaluation: parseEvaluation(input.evaluation) };
}

async function request<T>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  parse: (body: unknown) => T | null,
  okStatuses: number[],
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, cache: "no-store" });
  } catch {
    return init.signal?.aborted ? { ok: false, kind: "aborted" } : { ok: false, ...errorKind(0, null) };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An abort while the body was still being read is not a server problem
    if (init.signal?.aborted) return { ok: false, kind: "aborted" };
    body = null;   // non-JSON body: handled by the status below
  }
  if (!okStatuses.includes(response.status)) return { ok: false, ...errorKind(response.status, body, response.headers.get("retry-after")) };
  const data = parse(body);
  return data === null ? { ok: false, ...errorKind(500, null) } : { ok: true, data };
}

// 201 means the run exists and a quota slot is spent, so an unreadable body is still a success (id null: refresh the list)
export function createRun(fetchFn: FetchFn, body: NewRunRequest, signal?: AbortSignal): Promise<ApiResult<{ id: number | null }>> {
  return request(
    fetchFn,
    BASE,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal },
    (json) => {
      const id = isRecord(json) ? num(json.id) : null;
      return { id: id !== null && Number.isInteger(id) && id > 0 ? id : null };
    },
    [201],
  );
}

export function listRuns(fetchFn: FetchFn, limit: number, signal?: AbortSignal): Promise<ApiResult<RunSummary[]>> {
  const safeLimit = Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 20;
  return request(
    fetchFn,
    `${BASE}?limit=${safeLimit}`,
    { method: "GET", signal },
    (json) => {
      if (!isRecord(json) || !Array.isArray(json.runs)) return null;
      return json.runs.map(parseRunSummary).filter((run): run is RunSummary => run !== null);
    },
    [200],
  );
}

export function getRunDetail(fetchFn: FetchFn, id: number, signal?: AbortSignal): Promise<ApiResult<RunDetail>> {
  const text = String(id);
  if (!RUN_ID.test(text)) return Promise.resolve({ ok: false, kind: "not_found" });
  return request(fetchFn, `${BASE}/${text}`, { method: "GET", signal }, parseRunDetail, [200]);
}

// The committed benchmark of the shipped brain (public/brains/snake.eval.json, written by scripts/compare.ts --json)
export function parseBaseline(input: unknown): BaselineBrain[] | null {
  if (!isRecord(input) || !Array.isArray(input.brains)) return null;
  const brains: BaselineBrain[] = [];
  for (const item of input.brains) {
    if (!isRecord(item) || typeof item.algorithm !== "string") continue;
    const evaluation = parseEvaluation({ variants: item.variants, overall: item.overall });
    if (evaluation) brains.push({ algorithm: item.algorithm, featuresVersion: num(item.featuresVersion), episodes: num(item.episodes), evaluation });
  }
  return brains;
}

// A failure (404 included) just means there is no baseline row
export async function fetchBaseline(fetchFn: FetchFn, signal?: AbortSignal): Promise<BaselineBrain[] | null> {
  try {
    const response = await fetchFn("/brains/snake.eval.json", { signal });
    if (!response.ok) return null;
    return parseBaseline(await response.json());
  } catch {
    return null;
  }
}
