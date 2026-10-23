// Real dependencies of the public training API (used by the route files only).
import { Pool } from "pg";

import type { ApiDeps } from "./api.ts";
import { createDeps, withDeps } from "./deps.ts";
import { PgJobStore } from "./jobs.ts";
import { createLimiter } from "./limiter.ts";
import type { Limiter } from "./limiter.ts";
import { isTrainingEnabled, readPublicConfig } from "./public-config.ts";

// Cached on globalThis so every route bundle shares one limiter and one pool (like src/lib/db.ts does for the contact pool)
const globalForTraining = globalThis as unknown as { trainingPool?: Pool; trainingLimiter?: Limiter };

// Separate from the contact form's pool, small, with timeouts, so training can never starve the contact form
function getTrainingPool(): Pool {
  if (!globalForTraining.trainingPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL environment variable is not set");
    globalForTraining.trainingPool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  }
  return globalForTraining.trainingPool;
}

function getLimiter(): Limiter {
  globalForTraining.trainingLimiter ??= createLimiter();
  return globalForTraining.trainingLimiter;
}

function trainingDeps(): ApiDeps {
  return createDeps({
    enabled: isTrainingEnabled(),
    makeStore: () => new PgJobStore(getTrainingPool()),
    readConfig: () => readPublicConfig(),
    limiter: getLimiter(),
  });
}

export function withTraining(handler: (deps: ApiDeps) => Promise<Response>): Promise<Response> {
  return withDeps(trainingDeps, handler);
}
