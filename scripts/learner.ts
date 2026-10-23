// Learns from the Snake games players submitted and publishes a new brain if it passes the evaluation gate.
// Usage: DATABASE_URL=... (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) node scripts/learner.ts [--dry-run]
//        node scripts/learner.ts rollback [brainId|builtin]
import { readFileSync } from "node:fs";

import { Pool } from "pg";
import type { PoolConfig } from "pg";

import { GAME_ID, learnOnce } from "../src/lib/snake-learning/learner.ts";
import { poolConfigFromEnv } from "../src/lib/training/connection.ts";
import { PgSubmissionStore } from "../src/lib/training/submissions.ts";
import type { SubmissionStore } from "../src/lib/training/submissions.ts";

const BRAIN_FILE = "public/brains/snake.json";
// Arbitrary constant, distinct from the job store (74_110_001/2) and submission store (74_110_003) keys
const LEARNER_LOCK_KEY = 74_110_004;

function usage(): never {
  console.error("usage: node scripts/learner.ts [--dry-run] | rollback [brainId|builtin]");
  process.exit(2);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] === "rollback" ? "rollback" : "learn";
  const dryRun = args.includes("--dry-run");
  if (command === "learn" && args.some((a) => a !== "--dry-run")) usage();

  let config: PoolConfig;
  try {
    config = poolConfigFromEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "invalid configuration");
    process.exit(1);
  }
  const pool = new Pool({ ...config, max: 3 });
  // Session-level lock lives on this dedicated connection until released or the connection drops
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS locked", [LEARNER_LOCK_KEY]);
    if (!rows[0].locked) {
      console.error("another learner is running; exiting");
      process.exitCode = 1;
      return;
    }
    const store = new PgSubmissionStore(pool);

    if (command === "rollback") {
      const target = args[1] ?? "builtin";
      const brainId = target === "builtin" ? null : Number(target);
      if (brainId !== null && (!Number.isInteger(brainId) || brainId < 1)) usage();
      await store.rollback(GAME_ID, brainId);
      console.log(`rolled back ${GAME_ID} to ${brainId === null ? "the built-in brain" : `brain ${brainId}`}`);
      return;
    }

    // Dry run: same computation, but nothing is written
    const dryStore: SubmissionStore = dryRun ? Object.assign(Object.create(store) as SubmissionStore, { recordGeneration: async () => undefined }) : store;
    const report = await learnOnce(
      { store: dryStore, loadBuiltinBrain: () => JSON.parse(readFileSync(BRAIN_FILE, "utf8")) as unknown, now: () => new Date() },
      {},
    );
    console.log(`${dryRun ? "[dry run] " : ""}learner ${report.at}`);
    console.log(`base: ${report.base}${report.baseBrainId === null ? "" : ` (brain ${report.baseBrainId})`}, pending: ${report.pending}`);
    console.log(`games used: ${report.gamesUsed}, transitions: ${report.transitionsLearned}, deferred: ${report.deferred}`);
    console.log("not used:", report.rejected);
    if (report.before && report.after) {
      console.log(`eval avg: ${report.before.avg.toFixed(2)} -> ${report.after.avg.toFixed(2)}`);
    }
    console.log(`gate: ${report.gatePassed ? "passed" : "refused"}, floor: ${report.floorPassed ? "passed" : "refused"}, published: ${report.published && !dryRun ? "yes" : "no"}`);
  } finally {
    try {
      await lockClient.query("SELECT pg_advisory_unlock($1::bigint)", [LEARNER_LOCK_KEY]);
    } catch {
      // Closing the connection releases the session lock anyway
    }
    lockClient.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`learner failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
