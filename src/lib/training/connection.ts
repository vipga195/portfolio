// Database connection settings from the environment. DATABASE_URL wins; otherwise the standard PG* variables are used
// (they avoid URL-encoding problems with passwords that contain reserved characters).
import type { PoolConfig } from "pg";

export function poolConfigFromEnv(env: Record<string, string | undefined> = process.env): PoolConfig {
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL };
  if (env.PGHOST) {
    const port = env.PGPORT ? Number(env.PGPORT) : 5432;
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PGPORT must be a port number");
    return { host: env.PGHOST, port, user: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE };
  }
  throw new Error("database not configured: set DATABASE_URL, or PGHOST (with PGUSER, PGPASSWORD, PGDATABASE)");
}
