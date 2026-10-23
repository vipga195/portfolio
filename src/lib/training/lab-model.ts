// Pure logic of the Training Lab page (no React, no fetch): polling delays, merging, curves, comparison, error mapping, form validation.
import { ALGORITHM_UI } from "./ui-schema.ts";
import type { AlgorithmId } from "./ui-schema.ts";

// ---- API shapes as the UI sees them ----

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type RunSummary = {
  id: number;
  game: string;
  algorithm: string;
  status: RunStatus;
  episodesDone: number;
  episodesTotal: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  evalOverall: number | null;
};

export type Metric = { episode: number; avg: number; best: number; loss: number | null };

export type VariantResult = { label: string; avg: number; best: number };

export type Evaluation = { variants: VariantResult[]; overall: number };

export type RunDetail = RunSummary & { params: Record<string, number>; metrics: Metric[]; evaluation: Evaluation | null };

export function isActive(status: RunStatus): boolean {
  return status === "queued" || status === "running";
}

// ---- polling ----

// Request budget (default per-client read budget is 60/min, shared by list and detail):
//   active: list every 3 s (20/min) + detail of the selected running run every 5 s (12/min) = 32/min
//   idle: list every 10 s (6/min)
export const POLL_ACTIVE_MS = 3000;
export const DETAIL_ACTIVE_MS = 5000;
export const POLL_IDLE_MS = 10_000;
export const POLL_MAX_BACKOFF_MS = 30_000;

// null = do not poll (tab hidden)
export function nextPollDelayMs(state: { hasActive: boolean; consecutiveErrors: number; hidden: boolean }): number | null {
  if (state.hidden) return null;
  if (state.consecutiveErrors > 0) return Math.min(POLL_MAX_BACKOFF_MS, 2000 * 2 ** state.consecutiveErrors);
  return state.hasActive ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

export const MAX_KEPT_RUNS = 50;

// By id, incoming wins, newest (highest id) first. Beyond `cap` entries the oldest FINISHED runs are dropped (active ones stay).
export function mergeRuns(existing: RunSummary[], incoming: RunSummary[], cap: number = MAX_KEPT_RUNS): RunSummary[] {
  const byId = new Map<number, RunSummary>();
  for (const run of existing) byId.set(run.id, run);
  for (const run of incoming) byId.set(run.id, run);
  const merged = [...byId.values()].sort((a, b) => b.id - a.id);
  while (merged.length > cap) {
    let drop = -1;
    for (let i = merged.length - 1; i >= 0; i--) {
      if (!isActive(merged[i].status)) {
        drop = i;
        break;
      }
    }
    if (drop === -1) break;
    merged.splice(drop, 1);
  }
  return merged;
}

// Active runs we knew about that are missing from the latest list window (they fell out of the top N): their status is unknown
export function vanishedActiveIds(previous: RunSummary[], latestWindow: RunSummary[]): number[] {
  const inWindow = new Set(latestWindow.map((r) => r.id));
  const oldestInWindow = latestWindow.length > 0 ? Math.min(...latestWindow.map((r) => r.id)) : Infinity;
  return previous.filter((r) => isActive(r.status) && !inWindow.has(r.id) && r.id < oldestInWindow).map((r) => r.id);
}

export function toSummary(detail: RunDetail): RunSummary {
  return {
    id: detail.id, game: detail.game, algorithm: detail.algorithm, status: detail.status, episodesDone: detail.episodesDone,
    episodesTotal: detail.episodesTotal, createdAt: detail.createdAt, finishedAt: detail.finishedAt, error: detail.error,
    evalOverall: detail.evaluation?.overall ?? detail.evalOverall,
  };
}

// First selection on load: an active run if any, else the newest finished one, else nothing
export function pickInitialSelection(runs: RunSummary[]): number | null {
  const sorted = [...runs].sort((a, b) => b.id - a.id);
  return (sorted.find((r) => isActive(r.status)) ?? sorted.find((r) => r.status === "succeeded"))?.id ?? null;
}

// ---- request scheduling (pure) ----

// 429 handling shared by every read request: nothing is sent before `blockedUntil`
export type ReadGate = { blockedUntil: number };

// Can a refresh (tab became visible, run created) go out now, or how long to wait? Never sooner than one normal interval
// after the previous request, never before blockedUntil.
export function shouldRefreshNow(now: number, lastFetchAt: number, blockedUntil: number, intervalMs: number): { now: boolean; waitMs: number } {
  const waitMs = Math.max(0, lastFetchAt + intervalMs - now, blockedUntil - now);
  return { now: waitMs === 0, waitMs };
}

export const COMPARE_MAX_ATTEMPTS = 3;
export const COMPARE_BASE_RETRY_MS = 4000;

export type FetchState = { status: "idle" | "inflight" | "done" | "failed"; attempts: number; retryAt: number };

export const IDLE_STATE: FetchState = { status: "idle", attempts: 0, retryAt: 0 };

// 4, 8, 16 s
export function retryDelayMs(attempts: number): number {
  return COMPARE_BASE_RETRY_MS * 2 ** Math.max(0, attempts - 1);
}

export type NextFetch = { kind: "fetch"; id: number } | { kind: "wait"; waitMs: number } | { kind: "idle" };

// Sequential: nothing while a request is in flight. Skips finished and exhausted ids; honours blockedUntil and per-id retry times.
export function pickNextToFetch(selected: number[], state: Record<number, FetchState | undefined>, blockedUntil: number, now: number): NextFetch {
  let wait = Infinity;
  let candidate: number | null = null;
  for (const id of selected) {
    const st = state[id] ?? IDLE_STATE;
    if (st.status === "inflight") return { kind: "idle" };
    if (st.status === "done" || (st.status === "failed" && st.attempts >= COMPARE_MAX_ATTEMPTS)) continue;
    const readyAt = Math.max(st.status === "failed" ? st.retryAt : 0, blockedUntil);
    if (readyAt <= now) {
      candidate ??= id;
    } else {
      wait = Math.min(wait, readyAt - now);
    }
  }
  if (candidate !== null) return { kind: "fetch", id: candidate };
  return Number.isFinite(wait) ? { kind: "wait", waitMs: wait } : { kind: "idle" };
}

// ---- formatting ----

const formatters = new Map<string, Intl.NumberFormat>();

export function formatNumber(locale: string, value: number, maxFractionDigits = 1): string {
  const key = `${locale}:${maxFractionDigits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: maxFractionDigits });
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

export type Duration = { unit: "seconds" | "minutes" | "hours"; value: number };

// Retry-After for people: under 90 s in seconds, under 90 min in minutes, else hours (always rounded up)
export function humanizeDuration(totalSeconds: number): Duration {
  const seconds = Math.max(1, Math.ceil(totalSeconds));
  if (seconds < 90) return { unit: "seconds", value: seconds };
  if (seconds < 90 * 60) return { unit: "minutes", value: Math.ceil(seconds / 60) };
  return { unit: "hours", value: Math.ceil(seconds / 3600) };
}

// "grid 8x8" -> 8; anything else -> null (the caller shows the raw label)
export function parseGridSize(label: string): number | null {
  const match = /^grid (\d{1,3})x(\d{1,3})$/i.exec(label.trim());
  return match && match[1] === match[2] ? Number(match[1]) : null;
}

// ---- learning curve ----

export type Point = { x: number; y: number };
export type Tick = { position: number; label: string };

export type Curve = {
  avgPath: string;
  bestPath: string;
  avgPoints: Point[];
  bestPoints: Point[];
  xTicks: Tick[];
  yTicks: Tick[];
  pointCount: number;
};

export type CurveBox = { width: number; height: number; left: number; right: number; top: number; bottom: number };

// 1, 2, 5 x 10^k at or above `x`
function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const exp = 10 ** Math.floor(Math.log10(x));
  const f = x / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function decimalsOf(step: number): number {
  return step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
}

// Round tick values from 0 up to a "nice" maximum that covers `high`. With `integers` the step is at least 1.
function niceAxis(high: number, wantTicks: number, integers: boolean): { max: number; ticks: number[]; decimals: number } {
  let step = niceStep(high / (wantTicks - 1));
  if (integers) step = Math.max(1, step);
  const count = Math.max(1, Math.ceil(high / step - 1e-9));
  return { max: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step), decimals: decimalsOf(step) };
}

function toPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

// Anything beyond this is treated as garbage (also keeps all arithmetic far from overflow)
export const MAX_ABS_VALUE = 1e9;

export function buildCurve(metrics: Metric[], box: CurveBox): Curve {
  const sane = (v: number): boolean => Number.isFinite(v) && Math.abs(v) <= MAX_ABS_VALUE;
  const clean = metrics.filter((m) => sane(m.episode) && sane(m.avg) && sane(m.best) && m.episode >= 0).sort((a, b) => a.episode - b.episode);
  const innerW = Math.max(1, box.width - box.left - box.right);
  const innerH = Math.max(1, box.height - box.top - box.bottom);
  if (clean.length === 0) return { avgPath: "", bestPath: "", avgPoints: [], bestPoints: [], xTicks: [], yTicks: [], pointCount: 0 };

  const lastEpisode = clean[clean.length - 1].episode;
  const values = clean.flatMap((m) => [m.avg, m.best]);
  const low = Math.min(0, ...values);
  const high = Math.max(...values);
  const integers = values.every(Number.isInteger);
  // Scores are non-negative; if a negative value ever shows up the axis starts at it
  const yAxis = niceAxis(Math.max(high - Math.min(low, 0), 1e-9), 5, integers);
  const yMin = Math.min(low, 0);
  const yMax = yMin + yAxis.max;
  const xAxis = niceAxis(Math.max(lastEpisode, 1), 5, true);

  const xOf = (episode: number): number => box.left + (episode / xAxis.max) * innerW;
  const yOf = (value: number): number => box.top + innerH - ((value - yMin) / (yMax - yMin)) * innerH;

  const avgPoints = clean.map((m) => ({ x: xOf(m.episode), y: yOf(m.avg) }));
  const bestPoints = clean.map((m) => ({ x: xOf(m.episode), y: yOf(m.best) }));
  const xTicks = xAxis.ticks.map((value) => ({ position: xOf(value), label: String(value) }));
  const yTicks = yAxis.ticks.map((value) => ({ position: yOf(yMin + value), label: (yMin + value).toFixed(yAxis.decimals) }));
  return { avgPath: toPath(avgPoints), bestPath: toPath(bestPoints), avgPoints, bestPoints, xTicks, yTicks, pointCount: clean.length };
}

// ---- comparison table ----

export type CompareEntry = { key: string; label: string; kind: "baseline" | "run"; evaluation: Evaluation | null };

export type CompareCell = { avg: number; best: number; avgIsBest: boolean; bestIsBest: boolean };

export type CompareRow = { key: string; label: string; kind: "baseline" | "run"; cells: (CompareCell | null)[]; overall: number; overallIsBest: boolean };

export type Comparison = { columns: string[]; rows: CompareRow[] };

// Entries without an evaluation are left out. The baseline rows come first. Highest value per column is flagged.
export function buildComparison(entries: CompareEntry[], baselines: CompareEntry[]): Comparison {
  const all = [...baselines, ...entries].filter((e): e is CompareEntry & { evaluation: Evaluation } => e.evaluation !== null);
  const columns: string[] = [];
  for (const entry of all) for (const v of entry.evaluation.variants) if (!columns.includes(v.label)) columns.push(v.label);

  const lookup = (entry: { evaluation: Evaluation }, label: string): VariantResult | undefined => entry.evaluation.variants.find((v) => v.label === label);
  const bestAvg = columns.map((c) => Math.max(...all.map((e) => lookup(e, c)?.avg ?? -Infinity)));
  const bestBest = columns.map((c) => Math.max(...all.map((e) => lookup(e, c)?.best ?? -Infinity)));
  const bestOverall = Math.max(...all.map((e) => e.evaluation.overall));

  const rows = all.map((entry): CompareRow => ({
    key: entry.key,
    label: entry.label,
    kind: entry.kind,
    cells: columns.map((c, i) => {
      const v = lookup(entry, c);
      return v ? { avg: v.avg, best: v.best, avgIsBest: v.avg === bestAvg[i], bestIsBest: v.best === bestBest[i] } : null;
    }),
    overall: entry.evaluation.overall,
    overallIsBest: entry.evaluation.overall === bestOverall,
  }));
  return { columns, rows };
}

// ---- API errors ----

export const ERROR_KINDS = [
  "rate_limited", "queue_full", "client_limit", "global_limit", "invalid_field", "invalid_body", "forbidden_origin", "server_error", "disabled", "network", "not_found",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export type ApiErrorInfo = { kind: ErrorKind; field?: string; retryAfterSeconds?: number };

function isKind(value: unknown): value is ErrorKind {
  return typeof value === "string" && ERROR_KINDS.some((k) => k === value);
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === "string" && /^\d{1,6}$/.test(value.trim()) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
}

// status 0 = the request never got a response
export function errorKind(status: number, body: unknown, retryAfterHeader?: string | null): ApiErrorInfo {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};   // body is untrusted JSON, fields checked below
  const code = record.error;
  const retryAfterSeconds = positiveInt(retryAfterHeader ?? undefined) ?? positiveInt(record.retryAfterSeconds);
  const withRetry = (info: ApiErrorInfo): ApiErrorInfo => (retryAfterSeconds === undefined ? info : { ...info, retryAfterSeconds });

  if (status === 0) return { kind: "network" };
  if (code === "training_disabled") return { kind: "disabled" };
  if (status === 429) {
    const kind = isKind(code) && ["rate_limited", "queue_full", "client_limit", "global_limit"].includes(code) ? code : "rate_limited";
    return withRetry({ kind });
  }
  if (status === 404) return { kind: "not_found" };
  if (code === "forbidden_origin" || status === 403) return { kind: "forbidden_origin" };
  if (code === "invalid_field") return { kind: "invalid_field", field: typeof record.field === "string" ? record.field.slice(0, 40) : undefined };
  if (status === 400 || status === 413 || status === 415 || code === "invalid_body") return { kind: "invalid_body" };
  return { kind: "server_error" };
}

// ---- form validation ----

export type FieldErrorCode = "not_a_number" | "out_of_range" | "not_integer";
export type FieldError = { code: FieldErrorCode; min: number; max: number };

export type FormValues = { episodes: string | number; params: Record<string, string | number> };

export type FormResult = { ok: true; episodes: number; params: Record<string, number> } | { ok: false; errors: Record<string, FieldError> };

function parseNumber(raw: string | number | undefined): number {
  if (typeof raw === "number") return raw;
  if (raw === undefined || raw.trim() === "") return NaN;   // Number("") would be 0
  return Number(raw);
}

function check(value: number, min: number, max: number, integer: boolean): FieldErrorCode | null {
  if (!Number.isFinite(value)) return "not_a_number";
  if (value < min || value > max) return "out_of_range";
  if (integer && !Number.isInteger(value)) return "not_integer";
  return null;
}

export function validateForm(algorithmId: AlgorithmId, values: FormValues): FormResult {
  const ui = ALGORITHM_UI[algorithmId];
  const errors: Record<string, FieldError> = {};
  const episodes = parseNumber(values.episodes);
  const episodeError = check(episodes, 1, ui.maxEpisodes, true);
  if (episodeError) errors.episodes = { code: episodeError, min: 1, max: ui.maxEpisodes };

  const params: Record<string, number> = {};
  for (const field of ui.fields) {
    const value = parseNumber(values.params[field.key]);
    const error = check(value, field.min, field.max, field.integer);
    if (error) errors[field.key] = { code: error, min: field.min, max: field.max };
    else params[field.key] = value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, episodes, params };
}
