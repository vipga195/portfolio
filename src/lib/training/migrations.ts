// Shared by scripts/migrate.ts and the Postgres tests.
// 001/002 are idempotent (IF NOT EXISTS), so running them on a database that already has the objects but no
// schema_migrations record is safe: they only get recorded.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Client } from "pg";

export type MigrationReport = { applied: string[]; skipped: string[] };

export async function applyMigrations(client: Client, dir: string, options: { dryRun?: boolean } = {}): Promise<MigrationReport> {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())");
  const done = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
  const recorded = new Set(done.rows.map((row) => row.name));
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();

  const report: MigrationReport = { applied: [], skipped: [] };
  for (const file of files) {
    if (recorded.has(file)) {
      report.skipped.push(file);
      continue;
    }
    if (!options.dryRun) {
      // Each file and its record commit together, so a failed file leaves no half-applied state
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Keep the original error; the caller closes the connection
        }
        throw error;
      }
    }
    report.applied.push(file);
  }
  return report;
}
