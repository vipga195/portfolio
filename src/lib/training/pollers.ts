// Request scheduling of the Training Lab, kept out of React so it can be simulated with a fake clock.
// Rules: at most one request in flight per poller, nothing is sent before the shared `gate.blockedUntil` (a 429 sets it),
// a request counts from the moment it STARTS (so aborting on tab hide and re-showing cannot raise the rate), and an
// aborted request that settles late can never touch state: only the current request is allowed to apply its result.
import type { ApiResult } from "./lab-client.ts";
import {
  COMPARE_MAX_ATTEMPTS, DETAIL_ACTIVE_MS, IDLE_STATE, isActive, mergeRuns, nextPollDelayMs, pickNextToFetch, retryDelayMs, shouldRefreshNow,
  toSummary, vanishedActiveIds,
} from "./lab-model.ts";
import type { ErrorKind, FetchState, ReadGate, RunDetail, RunStatus, RunSummary } from "./lab-model.ts";

export type Clock = {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

export type ReadError = { kind: ErrorKind; retryAfterSeconds?: number };

const RATE_LIMIT_KINDS: readonly ErrorKind[] = ["rate_limited", "queue_full", "client_limit", "global_limit"];
const DEFAULT_BLOCK_SECONDS = 30;

// A 429 on a read request blocks every read request until Retry-After has passed
function noteFailure(gate: ReadGate, now: number, failure: ReadError): void {
  if (RATE_LIMIT_KINDS.includes(failure.kind)) gate.blockedUntil = Math.max(gate.blockedUntil, now + (failure.retryAfterSeconds ?? DEFAULT_BLOCK_SECONDS) * 1000);
}

function failureOf(result: ApiResult<unknown>): ReadError | null {
  if (result.ok || result.kind === "aborted") return null;
  return { kind: result.kind, retryAfterSeconds: result.retryAfterSeconds };
}

// ---------------------------------------------------------------- run list

export type ListState = { runs: RunSummary[] | null; error: ReadError | null };

export type ListPollerDeps = {
  clock: Clock;
  gate: ReadGate;
  fetchList: (signal: AbortSignal) => Promise<ApiResult<RunSummary[]>>;
  fetchDetail: (id: number, signal: AbortSignal) => Promise<ApiResult<RunDetail>>;
  onChange: (state: ListState) => void;
};

export type ListPoller = {
  start(): void;
  stop(): void;
  setVisible(visible: boolean): void;
  // After creating a run: poll at the active pace (a new run is about to be queued) but never faster than the normal interval
  refreshSoon(): void;
  // The latest list window only decides the pace: a run that fell out of the window stops counting
  hasActive(): boolean;
};

export function createListPoller(deps: ListPollerDeps): ListPoller {
  const { clock, gate } = deps;
  let runs: RunSummary[] | null = null;
  let windowHasActive = false;
  let hint = false;
  let errors = 0;
  let lastStartAt = Number.NEGATIVE_INFINITY;
  let visible = true;
  let stopped = true;
  let timer: unknown;
  let current: AbortController | null = null;
  let error: ReadError | null = null;
  const checkedVanished = new Set<number>();

  const emit = (): void => deps.onChange({ runs, error });

  const cancelTimer = (): void => {
    if (timer !== undefined) clock.clearTimer(timer);
    timer = undefined;
  };

  const schedule = (): void => {
    cancelTimer();
    if (stopped || !visible || current) return;
    const interval = nextPollDelayMs({ hasActive: windowHasActive || hint, consecutiveErrors: errors, hidden: false }) ?? 0;
    const { waitMs } = shouldRefreshNow(clock.now(), lastStartAt, gate.blockedUntil, interval);
    timer = clock.setTimer(() => void tick(), waitMs);
  };

  const fetchVanished = async (ids: number[]): Promise<void> => {
    for (const id of ids) {
      if (checkedVanished.has(id) || stopped) continue;
      checkedVanished.add(id);
      if (clock.now() < gate.blockedUntil) return;
      const controller = new AbortController();
      const result = await deps.fetchDetail(id, controller.signal);
      if (stopped || !result.ok) continue;
      runs = mergeRuns(runs ?? [], [toSummary(result.data)]);
      emit();
    }
  };

  const tick = async (): Promise<void> => {
    timer = undefined;
    if (stopped || !visible || current) return;
    if (clock.now() < gate.blockedUntil) {
      schedule();
      return;
    }
    const controller = new AbortController();
    current = controller;
    lastStartAt = clock.now();
    const result = await deps.fetchList(controller.signal);
    if (current !== controller) return;   // superseded or aborted: ignore completely
    current = null;
    if (result.ok) {
      const previous = runs ?? [];
      errors = 0;
      error = null;
      hint = false;
      windowHasActive = result.data.some((run) => isActive(run.status));
      runs = mergeRuns(previous, result.data);
      emit();
      schedule();
      await fetchVanished(vanishedActiveIds(previous, result.data));
      return;
    }
    if (result.kind === "aborted") {
      schedule();
      return;
    }
    const failure = failureOf(result);
    if (failure) {
      noteFailure(gate, clock.now(), failure);
      errors += 1;
      error = failure;
      runs ??= [];
      emit();
    }
    schedule();
  };

  return {
    start() {
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      cancelTimer();
      current?.abort();
      current = null;
    },
    setVisible(next) {
      visible = next;
      if (!next) {
        cancelTimer();
        current?.abort();
        current = null;
      } else {
        schedule();
      }
    },
    refreshSoon() {
      hint = true;
      schedule();
    },
    hasActive: () => windowHasActive || hint,
  };
}

// ---------------------------------------------------------------- selected run detail

export type DetailPollerDeps = {
  clock: Clock;
  gate: ReadGate;
  fetchDetail: (id: number, signal: AbortSignal) => Promise<ApiResult<RunDetail>>;
  onDetail: (detail: RunDetail) => void;
  onError: (id: number, error: ReadError | null) => void;
  // True when the finished detail of this run is already cached (it never changes)
  isFinishedCached: (id: number) => boolean;
};

export type DetailPoller = {
  // `listStatus` is the status the run list currently shows for the run (undefined when unknown)
  select(id: number | null, listStatus: RunStatus | undefined): void;
  setVisible(visible: boolean): void;
  stop(): void;
};

export function createDetailPoller(deps: DetailPollerDeps): DetailPoller {
  const { clock, gate } = deps;
  let id: number | null = null;
  let lastListStatus: RunStatus | undefined;
  let current: AbortController | null = null;
  let timer: unknown;
  let errors = 0;
  let halted = false;   // not_found / disabled: stop polling this run
  let visible = true;
  let lastStartAt = Number.NEGATIVE_INFINITY;

  const cancelAll = (): void => {
    if (timer !== undefined) clock.clearTimer(timer);
    timer = undefined;
    current?.abort();
    current = null;
  };

  const schedule = (delayMs: number): void => {
    if (timer !== undefined) clock.clearTimer(timer);
    timer = undefined;
    if (id === null || halted || !visible || current) return;
    const { waitMs } = shouldRefreshNow(clock.now(), lastStartAt, gate.blockedUntil, delayMs);
    timer = clock.setTimer(() => void load(), waitMs);
  };

  const load = async (): Promise<void> => {
    timer = undefined;
    const target = id;
    if (target === null || halted || !visible || current) return;
    if (clock.now() < gate.blockedUntil) {
      schedule(0);
      return;
    }
    const controller = new AbortController();
    current = controller;
    lastStartAt = clock.now();
    const result = await deps.fetchDetail(target, controller.signal);
    if (current !== controller || id !== target) return;
    current = null;
    if (result.ok) {
      errors = 0;
      deps.onError(target, null);
      deps.onDetail(result.data);
      // Keep polling only while the run is queued/running; the fetch that saw it finish was the final one
      if (isActive(result.data.status)) schedule(DETAIL_ACTIVE_MS);
      return;
    }
    if (result.kind === "aborted") return;
    const failure = failureOf(result);
    if (!failure) return;
    deps.onError(target, failure);
    if (failure.kind === "not_found" || failure.kind === "disabled") {
      halted = true;
      return;
    }
    noteFailure(gate, clock.now(), failure);
    errors += 1;
    schedule(nextPollDelayMs({ hasActive: true, consecutiveErrors: errors, hidden: false }) ?? DETAIL_ACTIVE_MS);
  };

  return {
    select(next, listStatus) {
      const changed = next !== id;
      if (changed) {
        cancelAll();
        id = next;
        errors = 0;
        halted = false;
        lastListStatus = listStatus;
        deps.onError(next ?? 0, null);
        if (next === null) return;
        if (deps.isFinishedCached(next) && listStatus !== undefined && !isActive(listStatus)) return;
        schedule(0);
        return;
      }
      if (next === null) return;
      // Same run: the list now shows a different status (e.g. it just finished) -> one final fetch
      if (listStatus !== lastListStatus) {
        lastListStatus = listStatus;
        if (listStatus !== undefined && !isActive(listStatus) && !deps.isFinishedCached(next) && !current) schedule(0);
      }
    },
    setVisible(next) {
      visible = next;
      if (!next) {
        cancelAll();
      } else if (id !== null && !(lastListStatus !== undefined && !isActive(lastListStatus) && deps.isFinishedCached(id))) {
        schedule(DETAIL_ACTIVE_MS);
      }
    },
    stop() {
      cancelAll();
      id = null;
    },
  };
}

// ---------------------------------------------------------------- comparison details

export type CompareFetcherDeps = {
  clock: Clock;
  gate: ReadGate;
  fetchDetail: (id: number, signal: AbortSignal) => Promise<ApiResult<RunDetail>>;
  onDetail: (detail: RunDetail) => void;
  // null clears the error of that run
  onFailed: (id: number, error: ReadError | null) => void;
  isCached: (id: number) => boolean;
};

export type CompareFetcher = {
  setSelected(ids: number[]): void;
  retry(id: number): void;
  setVisible(visible: boolean): void;
  destroy(): void;
};

// Fetches each selected, uncached run exactly once, one at a time. Deselecting aborts only that run's request.
export function createCompareFetcher(deps: CompareFetcherDeps): CompareFetcher {
  const { clock, gate } = deps;
  const state = new Map<number, FetchState>();
  const controllers = new Map<number, AbortController>();
  let selected: number[] = [];
  let timer: unknown;
  let visible = true;
  let destroyed = false;

  const snapshot = (): Record<number, FetchState> => Object.fromEntries(state);

  const pump = (): void => {
    if (timer !== undefined) clock.clearTimer(timer);
    timer = undefined;
    if (destroyed || !visible) return;
    const pending = selected.filter((id) => !deps.isCached(id));
    for (const id of selected) if (deps.isCached(id)) state.set(id, { status: "done", attempts: 0, retryAt: 0 });
    const next = pickNextToFetch(pending, snapshot(), gate.blockedUntil, clock.now());
    if (next.kind === "wait") timer = clock.setTimer(pump, next.waitMs);
    else if (next.kind === "fetch") void run(next.id);
  };

  const run = async (id: number): Promise<void> => {
    const controller = new AbortController();
    controllers.set(id, controller);
    const before = state.get(id) ?? IDLE_STATE;
    state.set(id, { ...before, status: "inflight" });
    const result = await deps.fetchDetail(id, controller.signal);
    if (controllers.get(id) !== controller) return;   // deselected or superseded
    controllers.delete(id);
    if (result.ok) {
      state.set(id, { status: "done", attempts: 0, retryAt: 0 });
      deps.onFailed(id, null);
      deps.onDetail(result.data);
    } else if (result.kind === "aborted") {
      state.set(id, { ...before, status: "idle" });
    } else {
      const failure = failureOf(result);
      if (failure && RATE_LIMIT_KINDS.includes(failure.kind)) {
        // Not this run's fault: wait for the shared block to pass and try again without counting an attempt
        noteFailure(gate, clock.now(), failure);
        state.set(id, { ...before, status: "idle" });
      } else {
        const attempts = before.attempts + 1;
        state.set(id, { status: "failed", attempts, retryAt: clock.now() + retryDelayMs(attempts) });
        if (attempts >= COMPARE_MAX_ATTEMPTS && failure) deps.onFailed(id, failure);
      }
    }
    pump();
  };

  return {
    setSelected(ids) {
      for (const [id, controller] of controllers) {
        if (!ids.includes(id)) {
          controller.abort();
          controllers.delete(id);
          state.set(id, IDLE_STATE);
        }
      }
      selected = ids;
      pump();
    },
    retry(id) {
      state.set(id, IDLE_STATE);
      deps.onFailed(id, null);
      pump();
    },
    setVisible(next) {
      visible = next;
      if (!next) {
        for (const [id, controller] of controllers) {
          controller.abort();
          controllers.delete(id);
          state.set(id, IDLE_STATE);
        }
        if (timer !== undefined) clock.clearTimer(timer);
        timer = undefined;
      } else {
        pump();
      }
    },
    destroy() {
      destroyed = true;
      if (timer !== undefined) clock.clearTimer(timer);
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    },
  };
}
