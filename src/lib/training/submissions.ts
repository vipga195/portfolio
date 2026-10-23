// Player-game submissions and the append-only brain publication log. PgSubmissionStore is the real thing;
// MemorySubmissionStore has the same semantics for unit tests.
import type { Pool, PoolClient } from "pg";

export type NewSubmission = { game: string; variant: string; seed: number; moves: string; sourceHash: string };

// Limits enforced atomically by addWithQuota. perSource/global count submissions (any status) inside the rolling window;
// maxPending caps the unprocessed backlog.
export type SubmissionLimits = { perSource: number; global: number; maxPending: number; windowMs: number };

export type SubmissionReason = "duplicate_seed" | "client_limit" | "global_limit" | "queue_full";

export type AddResult = { ok: true; id: number } | { ok: false; reason: SubmissionReason };

export type PendingSubmission = NewSubmission & { id: number; createdAt: Date };

export type GenerationBrain = { data: unknown; eval: unknown; featuresVersion: number; episodes: number };

export type GenerationInput = {
  game: string;
  usedIds: number[];
  rejected: { id: number; reason: string }[];
  // null = nothing learned, only the submissions are marked
  brain: GenerationBrain | null;
};

export type PublishedBrain = { brainId: number; data: unknown; eval: unknown; featuresVersion: number; publishedAt: Date };

export type SubmissionStore = {
  // Checked in this order: duplicate_seed (any status), global_limit, client_limit, queue_full. Atomic.
  addWithQuota(input: NewSubmission, limits: SubmissionLimits): Promise<AddResult>;
  // Oldest first
  listPending(game: string, limit: number): Promise<PendingSubmission[]>;
  // One transaction: marks submissions and, when brain is set, stores a trusted succeeded run + brain + 'generation' publication
  recordGeneration(input: GenerationInput): Promise<void>;
  // Null when nothing is published, or the newest publication points at the built-in brain (brain_id NULL)
  getPublished(game: string): Promise<PublishedBrain | null>;
  // Appends a 'rollback' publication (toBrainId null = built-in brain). Throws for a brain of another game, an unknown brain,
  // or a brain whose training run is not trusted.
  rollback(game: string, toBrainId: number | null): Promise<void>;
  // Deletes used/rejected submissions created before the date; pending ones are never touched
  purge(olderThan: Date): Promise<number>;
};

const MIN_RUN_EPISODES = 1;
const MAX_RUN_EPISODES = 1_000_000;
const RUN_ALGORITHM = "qlearning";

function runEpisodes(brain: GenerationBrain): number {
  // Upper bound matches the CHECK on training_runs.episodes_total (003_training.sql)
  return Math.min(MAX_RUN_EPISODES, Math.max(MIN_RUN_EPISODES, Math.floor(brain.episodes)));
}

type StoredBrain = { id: number; game: string; data: unknown; eval: unknown; featuresVersion: number; trusted: boolean };
type Publication = { id: number; game: string; brainId: number | null; reason: "generation" | "rollback"; createdAt: Date };
type StoredSubmission = PendingSubmission & { status: "pending" | "used" | "rejected"; rejectReason: string | null };

export class MemorySubmissionStore implements SubmissionStore {
  private submissions: StoredSubmission[] = [];
  private brains: StoredBrain[] = [];
  private publications: Publication[] = [];
  private nextSubmissionId = 1;
  private nextBrainId = 1;
  private nextPublicationId = 1;
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async addWithQuota(input: NewSubmission, limits: SubmissionLimits): Promise<AddResult> {
    if (this.submissions.some((s) => s.game === input.game && s.seed === input.seed)) return { ok: false, reason: "duplicate_seed" };
    const since = this.now() - limits.windowMs;
    const recent = this.submissions.filter((s) => s.game === input.game && s.createdAt.getTime() > since);
    if (recent.length >= limits.global) return { ok: false, reason: "global_limit" };
    if (recent.filter((s) => s.sourceHash === input.sourceHash).length >= limits.perSource) return { ok: false, reason: "client_limit" };
    if (this.submissions.filter((s) => s.game === input.game && s.status === "pending").length >= limits.maxPending) return { ok: false, reason: "queue_full" };
    const id = this.nextSubmissionId++;
    this.submissions.push({ ...input, id, createdAt: new Date(this.now()), status: "pending", rejectReason: null });
    return { ok: true, id };
  }

  async listPending(game: string, limit: number): Promise<PendingSubmission[]> {
    return this.submissions
      .filter((s) => s.game === game && s.status === "pending")
      .sort((a, b) => a.id - b.id)
      .slice(0, limit)
      .map(({ id, game: g, variant, seed, moves, sourceHash, createdAt }) => ({ id, game: g, variant, seed, moves, sourceHash, createdAt }));
  }

  async recordGeneration(input: GenerationInput): Promise<void> {
    // Validate and build everything first so a failure leaves nothing half-written (the Pg version uses a transaction)
    const pending = (id: number): StoredSubmission | undefined =>
      this.submissions.find((s) => s.id === id && s.game === input.game && s.status === "pending");
    const used = input.usedIds.map(pending).filter((s) => s !== undefined);
    const rejected = input.rejected.map((r) => ({ submission: pending(r.id), reason: r.reason }));
    if (input.brain) this.assertIntegerVersion(input.brain);
    for (const s of used) s.status = "used";
    for (const { submission, reason } of rejected) {
      if (!submission) continue;
      submission.status = "rejected";
      submission.rejectReason = reason;
    }
    if (input.brain) {
      const brain: StoredBrain = {
        id: this.nextBrainId++,
        game: input.game,
        data: input.brain.data,
        eval: input.brain.eval ?? null,
        featuresVersion: input.brain.featuresVersion,
        trusted: true,
      };
      this.brains.push(brain);
      this.publications.push({ id: this.nextPublicationId++, game: input.game, brainId: brain.id, reason: "generation", createdAt: new Date(this.now()) });
    }
  }

  private assertIntegerVersion(brain: GenerationBrain): void {
    if (!Number.isInteger(brain.featuresVersion)) throw new Error("brain featuresVersion must be an integer");
    runEpisodes(brain);
  }

  async getPublished(game: string): Promise<PublishedBrain | null> {
    const latest = this.publications.filter((p) => p.game === game).sort((a, b) => b.id - a.id)[0];
    if (!latest || latest.brainId === null) return null;
    const brain = this.brains.find((b) => b.id === latest.brainId);
    if (!brain) return null;
    return { brainId: brain.id, data: brain.data, eval: brain.eval, featuresVersion: brain.featuresVersion, publishedAt: latest.createdAt };
  }

  // Test-only: registers a brain whose training run is NOT trusted (generations always create trusted ones)
  addUntrustedBrainForTest(game: string, data: unknown, featuresVersion: number): number {
    const id = this.nextBrainId++;
    this.brains.push({ id, game, data, eval: null, featuresVersion, trusted: false });
    return id;
  }

  async rollback(game: string, toBrainId: number | null): Promise<void> {
    if (toBrainId !== null) {
      const brain = this.brains.find((b) => b.id === toBrainId);
      if (!brain) throw new Error(`brain ${toBrainId} not found`);
      if (brain.game !== game) throw new Error(`brain ${toBrainId} belongs to another game`);
      if (!brain.trusted) throw new Error(`brain ${toBrainId} is not trusted`);
    }
    this.publications.push({ id: this.nextPublicationId++, game, brainId: toBrainId, reason: "rollback", createdAt: new Date(this.now()) });
  }

  async purge(olderThan: Date): Promise<number> {
    const before = this.submissions.length;
    this.submissions = this.submissions.filter((s) => s.status === "pending" || s.createdAt.getTime() >= olderThan.getTime());
    return before - this.submissions.length;
  }
}

// Arbitrary constant, distinct from the job store keys (74_110_001/2)
const SUBMISSION_LOCK_KEY = 74_110_003;

type SubmissionRow = { id: string; game: string; variant: string; seed: string; moves: string; source_hash: string; created_at: Date };

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

export class PgSubmissionStore implements SubmissionStore {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async addWithQuota(input: NewSubmission, limits: SubmissionLimits): Promise<AddResult> {
    const client = await this.pool.connect();
    let failure: Error | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [SUBMISSION_LOCK_KEY]);
      const duplicate = await client.query("SELECT 1 FROM game_submissions WHERE game = $1 AND seed = $2", [input.game, input.seed]);
      let reason: SubmissionReason | null = null;
      if (duplicate.rowCount) reason = "duplicate_seed";
      else {
        const counts = await client.query<{ total: string; mine: string; pending: string }>(
          `SELECT count(*) FILTER (WHERE created_at > now() - ($1::double precision * interval '1 millisecond')) AS total,
                  count(*) FILTER (WHERE created_at > now() - ($1::double precision * interval '1 millisecond') AND source_hash = $2) AS mine,
                  count(*) FILTER (WHERE status = 'pending') AS pending
           FROM game_submissions
           WHERE game = $3 AND (created_at > now() - ($1::double precision * interval '1 millisecond') OR status = 'pending')`,
          [limits.windowMs, input.sourceHash, input.game],
        );
        const { total, mine, pending } = counts.rows[0];
        if (Number(total) >= limits.global) reason = "global_limit";
        else if (Number(mine) >= limits.perSource) reason = "client_limit";
        else if (Number(pending) >= limits.maxPending) reason = "queue_full";
      }
      if (reason) {
        await client.query("ROLLBACK");
        return { ok: false, reason };
      }
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO game_submissions (game, variant, seed, moves, source_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [input.game, input.variant, input.seed, input.moves, input.sourceHash],
      );
      await client.query("COMMIT");
      return { ok: true, id: Number(rows[0].id) };
    } catch (error) {
      failure = toError(error);
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release(failure);
    }
  }

  async listPending(game: string, limit: number): Promise<PendingSubmission[]> {
    const { rows } = await this.pool.query<SubmissionRow>(
      `SELECT id, game, variant, seed, moves, source_hash, created_at FROM game_submissions
       WHERE game = $1 AND status = 'pending' ORDER BY id LIMIT $2`,
      [game, limit],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      game: row.game,
      variant: row.variant,
      seed: Number(row.seed),
      moves: row.moves,
      sourceHash: row.source_hash,
      createdAt: row.created_at,
    }));
  }

  async recordGeneration(input: GenerationInput): Promise<void> {
    const client = await this.pool.connect();
    let failure: Error | undefined;
    try {
      await client.query("BEGIN");
      if (input.usedIds.length > 0) {
        await client.query(
          "UPDATE game_submissions SET status = 'used' WHERE game = $1 AND status = 'pending' AND id = ANY($2::bigint[])",
          [input.game, input.usedIds],
        );
      }
      for (const { id, reason } of input.rejected) {
        await client.query(
          "UPDATE game_submissions SET status = 'rejected', reject_reason = $3 WHERE game = $1 AND status = 'pending' AND id = $2",
          [input.game, id, reason],
        );
      }
      if (input.brain) {
        const episodes = runEpisodes(input.brain);
        const run = await client.query<{ id: string }>(
          `INSERT INTO training_runs (game, algorithm, episodes_total, episodes_done, status, trusted, finished_at)
           VALUES ($1, $2, $3, $3, 'succeeded', true, now()) RETURNING id`,
          [input.game, RUN_ALGORITHM, episodes],
        );
        const brain = await client.query<{ id: string }>(
          `INSERT INTO brains (run_id, game, algorithm, features_version, episodes, data, eval)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING id`,
          [run.rows[0].id, input.game, RUN_ALGORITHM, input.brain.featuresVersion, episodes, JSON.stringify(input.brain.data), JSON.stringify(input.brain.eval ?? null)],
        );
        await client.query("INSERT INTO brain_publications (game, brain_id, reason) VALUES ($1, $2, 'generation')", [input.game, brain.rows[0].id]);
      }
      await client.query("COMMIT");
    } catch (error) {
      failure = toError(error);
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release(failure);
    }
  }

  async getPublished(game: string): Promise<PublishedBrain | null> {
    const { rows } = await this.pool.query<{ id: string; data: unknown; eval: unknown; features_version: number; published_at: Date }>(
      `SELECT b.id, b.data, b.eval, b.features_version, p.created_at AS published_at
       FROM (SELECT brain_id, created_at FROM brain_publications WHERE game = $1 ORDER BY id DESC LIMIT 1) p
       JOIN brains b ON b.id = p.brain_id`,
      [game],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return { brainId: Number(row.id), data: row.data, eval: row.eval, featuresVersion: row.features_version, publishedAt: row.published_at };
  }

  async rollback(game: string, toBrainId: number | null): Promise<void> {
    // A single INSERT; the SELECT form rejects a brain of another game or an untrusted run without a separate check-then-insert race
    const result =
      toBrainId === null
        ? await this.pool.query("INSERT INTO brain_publications (game, brain_id, reason) VALUES ($1, NULL, 'rollback')", [game])
        : await this.pool.query(
            "INSERT INTO brain_publications (game, brain_id, reason) SELECT $1, b.id, 'rollback' FROM brains b JOIN training_runs r ON r.id = b.run_id AND r.trusted WHERE b.id = $2 AND b.game = $1",
            [game, toBrainId],
          );
    if (!result.rowCount) throw new Error(`brain ${toBrainId} not found (or not trusted) for game ${game}`);
  }

  async purge(olderThan: Date): Promise<number> {
    const result = await this.pool.query("DELETE FROM game_submissions WHERE status IN ('used', 'rejected') AND created_at < $1", [olderThan]);
    return result.rowCount ?? 0;
  }
}
