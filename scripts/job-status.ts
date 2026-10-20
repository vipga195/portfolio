// Prints the state of one training run.
// Usage: DATABASE_URL=... (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) node scripts/job-status.ts <id>
import { Pool } from "pg";
import type { PoolConfig } from "pg";

import { poolConfigFromEnv } from "../src/lib/training/connection.ts";
import { PgJobStore } from "../src/lib/training/jobs.ts";

async function main(): Promise<void> {
  const id = Number(process.argv[2]);
  let config: PoolConfig;
  try {
    config = poolConfigFromEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "database not configured");
    process.exit(1);
  }
  if (!Number.isInteger(id) || id < 1) {
    console.error("Usage: node scripts/job-status.ts <id>");
    process.exit(1);
  }
  const pool = new Pool({ ...config, max: 1 });
  try {
    const store = new PgJobStore(pool);
    const run = await store.getRun(id);
    if (!run) {
      console.error(`run ${id} not found`);
      process.exit(1);
    }
    console.log(`run ${run.id}: ${run.algorithm} on ${run.game}  status=${run.status}${run.trusted ? " (trusted)" : ""}`);
    console.log(`progress: ${run.episodesDone}/${run.episodesTotal} episodes`);
    if (run.error) console.log(`error: ${run.error}`);
    const metrics = await store.getMetrics(id);
    console.log(`metrics: ${metrics.length} rows${metrics.length > 0 ? ", last:" : ""}`);
    for (const m of metrics.slice(-3)) console.log(`  episode ${m.episode}  avg=${m.avg.toFixed(2)}  best=${m.best}${m.loss === null ? "" : `  loss=${m.loss.toFixed(4)}`}`);
    const brain = await store.getBrainInfo(id);
    console.log(brain ? `brain: ${brain.sizeBytes} bytes, features_version=${brain.featuresVersion}, episodes=${brain.episodes}` : "brain: none");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`job-status failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
