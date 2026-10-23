// Real dependencies of the public learning API (used by the route files only).
import { Pool } from "pg";

import type { Limiter } from "../training/limiter.ts";
import { createLimiter } from "../training/limiter.ts";
import { poolConfigFromEnv } from "../training/connection.ts";
import { PgSubmissionStore } from "../training/submissions.ts";
import type { SubmissionStore } from "../training/submissions.ts";
import type { LearningDeps } from "./api.ts";
import { DISABLED_LEARNING_CONFIG, isLearningEnabled, readLearningConfig, readSecret } from "./config.ts";

// Cached on globalThis so every route bundle shares one limiter and one pool
const globalForLearning = globalThis as unknown as { learningPool?: Pool; learningLimiter?: Limiter };

// Own small pool with timeouts, so learning can never starve the contact form or training
function getPool(): Pool {
  globalForLearning.learningPool ??= new Pool({ ...poolConfigFromEnv(), max: 3, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
  return globalForLearning.learningPool;
}

function getLimiter(): Limiter {
  globalForLearning.learningLimiter ??= createLimiter();
  return globalForLearning.learningLimiter;
}

// Handed out while the flag is off. Every handler answers 404 before touching it.
const unusedStore = new Proxy({}, {
  get: () => () => {
    throw new Error("learning is disabled");
  },
}) as SubmissionStore;   // every method throws; never called because handlers return early when disabled

function learningDeps(): LearningDeps {
  if (!isLearningEnabled()) {
    return { store: unusedStore, config: DISABLED_LEARNING_CONFIG, limiter: getLimiter(), secret: "", now: Date.now };
  }
  // The secret is read here and only here
  return { store: new PgSubmissionStore(getPool()), config: readLearningConfig(), limiter: getLimiter(), secret: readSecret(), now: Date.now };
}

// Turns a failing wiring step (bad config, missing secret, pool creation) into a plain JSON 500 without internals
export async function withLearning(handler: (deps: LearningDeps) => Promise<Response>): Promise<Response> {
  let deps: LearningDeps;
  try {
    deps = learningDeps();
  } catch (error) {
    console.error("learning api wiring error:", error);
    return Response.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return handler(deps);
}
