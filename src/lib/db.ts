import { Pool } from "pg";

// globalThis needs type assertion to add custom properties
const globalForDb = globalThis as unknown as { contactPool?: Pool };

export function getPool(): Pool {
  if (!globalForDb.contactPool) {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    globalForDb.contactPool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
    });
  }
  return globalForDb.contactPool;
}
