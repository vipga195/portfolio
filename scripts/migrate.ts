// Applies db/migrations/*.sql that are not recorded in schema_migrations yet.
// Usage: DATABASE_URL=... (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) node scripts/migrate.ts [--dry-run]
import { Client } from "pg";
import type { PoolConfig } from "pg";

import { poolConfigFromEnv } from "../src/lib/training/connection.ts";
import { applyMigrations } from "../src/lib/training/migrations.ts";

async function main(): Promise<void> {
  let config: PoolConfig;
  try {
    config = poolConfigFromEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "database not configured");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const client = new Client(config);
  await client.connect();
  try {
    const { applied, skipped } = await applyMigrations(client, "db/migrations", { dryRun });
    for (const name of skipped) console.log(`skipped ${name} (already recorded)`);
    for (const name of applied) console.log(`${dryRun ? "pending" : "applied"} ${name}`);
    if (applied.length === 0) console.log("nothing to apply");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`migrate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
