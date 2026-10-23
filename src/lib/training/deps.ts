// Pure wiring helpers (relative imports only, unit-tested). The flag decides whether anything gets created.
import type { ApiDeps } from "./api.ts";
import type { JobStore } from "./jobs.ts";
import type { Limiter } from "./limiter.ts";
import { DISABLED_CONFIG } from "./public-config.ts";
import type { PublicApiConfig } from "./public-config.ts";

export type DepsFactories = {
  enabled: boolean;
  // Creates the store (and with it the database pool); called only when enabled
  makeStore: () => JobStore;
  readConfig: () => PublicApiConfig;
  limiter: Limiter;
};

// Handed out while the flag is off. Every handler answers 404 before touching it.
const unusedStore = new Proxy({}, {
  get: () => () => {
    throw new Error("training is disabled");
  },
}) as JobStore;   // every method throws; never called because handlers return early when disabled

export function createDeps(factories: DepsFactories): ApiDeps {
  if (!factories.enabled) return { store: unusedStore, config: DISABLED_CONFIG, limiter: factories.limiter };
  return { store: factories.makeStore(), config: factories.readConfig(), limiter: factories.limiter };
}

// Turns a failing wiring step (bad config, pool creation) into a plain JSON 500 without internals
export async function withDeps(getDeps: () => ApiDeps, handler: (deps: ApiDeps) => Promise<Response>): Promise<Response> {
  let deps: ApiDeps;
  try {
    deps = getDeps();
  } catch (error) {
    console.error("training api wiring error:", error);
    return Response.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return handler(deps);
}
