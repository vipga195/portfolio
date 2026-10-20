// Job queue for training runs. PgJobStore is the real thing; MemoryJobStore has the same semantics for unit tests.
import type { Pool, PoolClient } from "pg";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

const STATUSES: readonly RunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled"];

export type TrainingRun = {
  id: number;
  game: string;
  algorithm: string;
  // Comes from the database or a client: never trust it, the runner re-validates with algorithm.parseParams
  params: unknown;
  episodesTotal: number;
  episodesDone: number;
  status: RunStatus;
  trusted: boolean;
  cancelRequested: boolean;
  ipHash: string | null;
  workerId: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
};

export type NewRun = {
  game: string;
  algorithm: string;
  params: unknown;
  episodesTotal: number;
  trusted?: boolean;
  ipHash?: string | null;
};

export type RunMetric = { episode: number; avg: number; best: number; loss: number | null };

export type CompleteInput = { brain: unknown; eval: unknown; episodes: number };

export type BrainInfo = { sizeBytes: number; featuresVersion: number; episodes: number };

// "cancelled": a queued run was cancelled at once. "requested": a running run will stop at its next cancel poll.
// "noop": already finished. "not-found": no such run.
export type CancelOutcome = "cancelled" | "requested" | "noop" | "not-found";

export const MAX_ERROR_LENGTH = 500;

export type JobStore = {
  enqueue(newRun: NewRun): Promise<TrainingRun>;
  // Atomically moves the oldest queued run to running; null when none is queued or maxRunning runs are already running
  claimNext(workerId: string, options: { maxRunning: number }): Promise<TrainingRun | null>;
  // Only affects a running run
  heartbeat(runId: number, episodesDone: number): Promise<void>;
  addMetric(runId: number, metric: RunMetric): Promise<void>;
  // Stores the brain and marks the run succeeded. False when the run is no longer running.
  complete(runId: number, input: CompleteInput): Promise<boolean>;
  // Marks a queued/running run failed (message truncated to 500 chars); finished runs are left alone
  fail(runId: number, message: string): Promise<void>;
  requestCancel(runId: number): Promise<CancelOutcome>;
  isCancelRequested(runId: number): Promise<boolean>;
  finishCancelled(runId: number): Promise<void>;
  // Running runs without a heartbeat for `olderThanMs` become failed ("worker lost"), never requeued (poison-job loops)
  failStale(olderThanMs: number): Promise<number>;
  // Puts a just-claimed running run back in the queue (shutdown began before it started). False when it was not running.
  requeue(runId: number): Promise<boolean>;
  getRun(runId: number): Promise<TrainingRun | null>;
  getMetrics(runId: number): Promise<RunMetric[]>;
  getBrainInfo(runId: number): Promise<BrainInfo | null>;
};

function truncate(message: string): string {
  return message.slice(0, MAX_ERROR_LENGTH);
}

// Brain JSON carries its own featuresVersion; read it defensively
function featuresVersionOf(brain: unknown): number {
  if (typeof brain === "object" && brain !== null && "featuresVersion" in brain) {
    const value = brain.featuresVersion;
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  throw new Error("brain has no integer featuresVersion");
}

export class MemoryJobStore implements JobStore {
  private runs: TrainingRun[] = [];
  private metrics = new Map<number, RunMetric[]>();
  private brains = new Map<number, BrainInfo>();
  private nextId = 1;
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private find(runId: number): TrainingRun | undefined {
    return this.runs.find((run) => run.id === runId);
  }

  async enqueue(newRun: NewRun): Promise<TrainingRun> {
    const run: TrainingRun = {
      id: this.nextId++,
      game: newRun.game,
      algorithm: newRun.algorithm,
      params: newRun.params,
      episodesTotal: newRun.episodesTotal,
      episodesDone: 0,
      status: "queued",
      trusted: newRun.trusted ?? false,
      cancelRequested: false,
      ipHash: newRun.ipHash ?? null,
      workerId: null,
      error: null,
      createdAt: new Date(this.now()),
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    };
    this.runs.push(run);
    return { ...run };
  }

  async claimNext(workerId: string, { maxRunning }: { maxRunning: number }): Promise<TrainingRun | null> {
    if (this.runs.filter((run) => run.status === "running").length >= maxRunning) return null;
    const run = this.runs.find((r) => r.status === "queued");
    if (!run) return null;
    run.status = "running";
    run.workerId = workerId;
    run.startedAt = new Date(this.now());
    run.heartbeatAt = new Date(this.now());
    return { ...run };
  }

  async heartbeat(runId: number, episodesDone: number): Promise<void> {
    const run = this.find(runId);
    if (run?.status !== "running") return;
    run.episodesDone = episodesDone;
    run.heartbeatAt = new Date(this.now());
  }

  async addMetric(runId: number, metric: RunMetric): Promise<void> {
    const list = this.metrics.get(runId) ?? [];
    const i = list.findIndex((m) => m.episode === metric.episode);
    if (i >= 0) list[i] = { ...metric };
    else list.push({ ...metric });
    this.metrics.set(runId, list);
  }

  async complete(runId: number, input: CompleteInput): Promise<boolean> {
    const run = this.find(runId);
    if (run?.status !== "running") return false;
    this.brains.set(runId, {
      sizeBytes: Buffer.byteLength(JSON.stringify(input.brain)),
      featuresVersion: featuresVersionOf(input.brain),
      episodes: input.episodes,
    });
    run.status = "succeeded";
    run.episodesDone = input.episodes;
    run.finishedAt = new Date(this.now());
    return true;
  }

  async fail(runId: number, message: string): Promise<void> {
    const run = this.find(runId);
    if (run?.status !== "queued" && run?.status !== "running") return;
    run.status = "failed";
    run.error = truncate(message);
    run.finishedAt = new Date(this.now());
  }

  async requestCancel(runId: number): Promise<CancelOutcome> {
    const run = this.find(runId);
    if (!run) return "not-found";
    if (run.status === "queued") {
      run.status = "cancelled";
      run.finishedAt = new Date(this.now());
      return "cancelled";
    }
    if (run.status === "running") {
      run.cancelRequested = true;
      return "requested";
    }
    return "noop";
  }

  async isCancelRequested(runId: number): Promise<boolean> {
    return this.find(runId)?.cancelRequested ?? false;
  }

  async finishCancelled(runId: number): Promise<void> {
    const run = this.find(runId);
    if (run?.status !== "running") return;
    run.status = "cancelled";
    run.finishedAt = new Date(this.now());
  }

  async failStale(olderThanMs: number): Promise<number> {
    const limit = this.now() - olderThanMs;
    let count = 0;
    for (const run of this.runs) {
      if (run.status === "running" && run.heartbeatAt !== null && run.heartbeatAt.getTime() < limit) {
        run.status = "failed";
        run.error = "worker lost";
        run.finishedAt = new Date(this.now());
        count++;
      }
    }
    return count;
  }

  async requeue(runId: number): Promise<boolean> {
    const run = this.find(runId);
    if (run?.status !== "running") return false;
    run.status = "queued";
    run.startedAt = null;
    run.heartbeatAt = null;
    run.workerId = null;
    return true;
  }

  async getRun(runId: number): Promise<TrainingRun | null> {
    const run = this.find(runId);
    return run ? { ...run } : null;
  }

  async getMetrics(runId: number): Promise<RunMetric[]> {
    return [...(this.metrics.get(runId) ?? [])].sort((a, b) => a.episode - b.episode);
  }

  async getBrainInfo(runId: number): Promise<BrainInfo | null> {
    return this.brains.get(runId) ?? null;
  }
}

// Arbitrary constant: serializes claimNext across workers so the maxRunning check cannot race
const CLAIM_LOCK_KEY = 74_110_001;
const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 10;

const RUN_COLUMNS = `id, game, algorithm, params, episodes_total, episodes_done, status, trusted, cancel_requested,
  ip_hash, worker_id, error, created_at, started_at, heartbeat_at, finished_at`;

type RunRow = {
  id: string;
  game: string;
  algorithm: string;
  params: unknown;
  episodes_total: number;
  episodes_done: number;
  status: string;
  trusted: boolean;
  cancel_requested: boolean;
  ip_hash: string | null;
  worker_id: string | null;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  heartbeat_at: Date | null;
  finished_at: Date | null;
};

function isStatus(value: string): value is RunStatus {
  return STATUSES.some((status) => status === value);
}

function mapRun(row: RunRow): TrainingRun {
  if (!isStatus(row.status)) throw new Error(`unexpected run status "${row.status}"`);
  return {
    id: Number(row.id),
    game: row.game,
    algorithm: row.algorithm,
    params: row.params,
    episodesTotal: row.episodes_total,
    episodesDone: row.episodes_done,
    status: row.status,
    trusted: row.trusted,
    cancelRequested: row.cancel_requested,
    ipHash: row.ip_hash,
    workerId: row.worker_id,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    heartbeatAt: row.heartbeat_at,
    finishedAt: row.finished_at,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// Never lets a failing ROLLBACK hide the error that caused it
async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The connection is destroyed by release(error) in the caller
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PgJobStore implements JobStore {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async enqueue(newRun: NewRun): Promise<TrainingRun> {
    const { rows } = await this.pool.query<RunRow>(
      `INSERT INTO training_runs (game, algorithm, params, episodes_total, trusted, ip_hash)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING ${RUN_COLUMNS}`,
      [newRun.game, newRun.algorithm, JSON.stringify(newRun.params ?? {}), newRun.episodesTotal, newRun.trusted ?? false, newRun.ipHash ?? null],
    );
    return mapRun(rows[0]);
  }

  async claimNext(workerId: string, { maxRunning }: { maxRunning: number }): Promise<TrainingRun | null> {
    const client = await this.pool.connect();
    // Any failure destroys the connection (release(error)) instead of returning it to the pool, possibly mid-transaction
    let failure: Error | undefined;
    try {
      return await this.claimWith(client, workerId, maxRunning);
    } catch (error) {
      failure = toError(error);
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release(failure);
    }
  }

  private async claimWith(client: PoolClient, workerId: string, maxRunning: number): Promise<TrainingRun | null> {
    // The lock is transaction-scoped. It is held only for the few statements below, so contention is brief:
    // retry a little instead of reporting "empty" while another worker is merely mid-claim.
    for (let attempt = 0; ; attempt++) {
      await client.query("BEGIN");
      const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock($1::bigint) AS ok", [CLAIM_LOCK_KEY]);
      if (lock.rows[0].ok) break;
      await client.query("ROLLBACK");
      if (attempt >= LOCK_RETRIES) return null;
      await sleep(LOCK_RETRY_MS);
    }
    const count = await client.query<{ n: string }>("SELECT count(*) AS n FROM training_runs WHERE status = 'running'");
    if (Number(count.rows[0].n) >= maxRunning) {
      await client.query("COMMIT");
      return null;
    }
    const { rows } = await client.query<RunRow>(
      `UPDATE training_runs SET status = 'running', started_at = now(), heartbeat_at = now(), worker_id = $1
       WHERE id = (SELECT id FROM training_runs WHERE status = 'queued' ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING ${RUN_COLUMNS}`,
      [workerId],
    );
    await client.query("COMMIT");
    return rows.length > 0 ? mapRun(rows[0]) : null;
  }

  async heartbeat(runId: number, episodesDone: number): Promise<void> {
    await this.pool.query("UPDATE training_runs SET episodes_done = $2, heartbeat_at = now() WHERE id = $1 AND status = 'running'", [runId, episodesDone]);
  }

  async addMetric(runId: number, metric: RunMetric): Promise<void> {
    await this.pool.query(
      `INSERT INTO training_metrics (run_id, episode, avg, best, loss) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_id, episode) DO UPDATE SET avg = EXCLUDED.avg, best = EXCLUDED.best, loss = EXCLUDED.loss`,
      [runId, metric.episode, metric.avg, metric.best, metric.loss],
    );
  }

  async complete(runId: number, input: CompleteInput): Promise<boolean> {
    const featuresVersion = featuresVersionOf(input.brain);
    const client = await this.pool.connect();
    let failure: Error | undefined;
    try {
      await client.query("BEGIN");
      const done = await client.query<{ game: string; algorithm: string }>(
        `UPDATE training_runs SET status = 'succeeded', episodes_done = $2, finished_at = now()
         WHERE id = $1 AND status = 'running' RETURNING game, algorithm`,
        [runId, input.episodes],
      );
      if (done.rows.length === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO brains (run_id, game, algorithm, features_version, episodes, data, eval)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [runId, done.rows[0].game, done.rows[0].algorithm, featuresVersion, input.episodes, JSON.stringify(input.brain), JSON.stringify(input.eval ?? null)],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      failure = toError(error);
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release(failure);
    }
  }

  async fail(runId: number, message: string): Promise<void> {
    await this.pool.query(
      "UPDATE training_runs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1 AND status IN ('queued', 'running')",
      [runId, truncate(message)],
    );
  }

  async requestCancel(runId: number): Promise<CancelOutcome> {
    const queued = await this.pool.query(
      "UPDATE training_runs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'queued'",
      [runId],
    );
    if (queued.rowCount) return "cancelled";
    const running = await this.pool.query("UPDATE training_runs SET cancel_requested = true WHERE id = $1 AND status = 'running'", [runId]);
    if (running.rowCount) return "requested";
    const exists = await this.pool.query("SELECT 1 FROM training_runs WHERE id = $1", [runId]);
    return exists.rowCount ? "noop" : "not-found";
  }

  async isCancelRequested(runId: number): Promise<boolean> {
    const { rows } = await this.pool.query<{ cancel_requested: boolean }>("SELECT cancel_requested FROM training_runs WHERE id = $1", [runId]);
    return rows[0]?.cancel_requested ?? false;
  }

  async finishCancelled(runId: number): Promise<void> {
    await this.pool.query("UPDATE training_runs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'running'", [runId]);
  }

  async failStale(olderThanMs: number): Promise<number> {
    const result = await this.pool.query(
      `UPDATE training_runs SET status = 'failed', error = 'worker lost', finished_at = now()
       WHERE status = 'running' AND heartbeat_at < now() - ($1::double precision * interval '1 millisecond')`,
      [olderThanMs],
    );
    return result.rowCount ?? 0;
  }

  async requeue(runId: number): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE training_runs SET status = 'queued', started_at = NULL, heartbeat_at = NULL, worker_id = NULL WHERE id = $1 AND status = 'running'",
      [runId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getRun(runId: number): Promise<TrainingRun | null> {
    const { rows } = await this.pool.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM training_runs WHERE id = $1`, [runId]);
    return rows.length > 0 ? mapRun(rows[0]) : null;
  }

  async getMetrics(runId: number): Promise<RunMetric[]> {
    const { rows } = await this.pool.query<{ episode: number; avg: number; best: number; loss: number | null }>(
      "SELECT episode, avg, best, loss FROM training_metrics WHERE run_id = $1 ORDER BY episode",
      [runId],
    );
    return rows.map((row) => ({ episode: row.episode, avg: row.avg, best: row.best, loss: row.loss }));
  }

  async getBrainInfo(runId: number): Promise<BrainInfo | null> {
    const { rows } = await this.pool.query<{ size: string; features_version: number; episodes: number }>(
      "SELECT octet_length(data::text) AS size, features_version, episodes FROM brains WHERE run_id = $1",
      [runId],
    );
    return rows.length > 0 ? { sizeBytes: Number(rows[0].size), featuresVersion: rows[0].features_version, episodes: rows[0].episodes } : null;
  }
}
