// Bounded in-memory fixed-window limiter. Per-process memory only (fine for one standalone container).
// Two kinds of budgets, checked together and atomically by consume():
//  - per-client counters: a Map capped at maxKeys; when full the oldest-inserted key is dropped (O(1), never a scan).
//    Flooding unique keys can therefore evict a real client's counter.
//  - global budgets: a separate tiny Map keyed by a fixed set of names that is never evicted, so no flood of client keys can
//    reset them. They cap total resource use; they do not guarantee fairness between clients.
export type Rule = { max: number; windowMs: number };
export type LimitResult = { allowed: boolean; retryAfterSeconds: number };
export type Limiter = {
  // A request passes only if BOTH budgets allow it; then both are charged. A denial changes no state at all.
  consume(client: { key: string; rule: Rule }, global: { name: string; rule: Rule }): LimitResult;
  // Number of per-client keys currently held
  size(): number;
};

type Counter = { start: number; count: number };

export const DEFAULT_MAX_KEYS = 10_000;
export const MAX_GLOBAL_BUDGETS = 32;

type Check = { allowed: boolean; retryAfterSeconds: number; fresh: boolean; counter: Counter | undefined };

// A window is over when it has run its length, or when the clock moved backwards (otherwise the key stays locked)
function check(counter: Counter | undefined, time: number, rule: Rule): Check {
  const fresh = !counter || time < counter.start || time - counter.start >= rule.windowMs;
  if (fresh || counter.count < rule.max) return { allowed: true, retryAfterSeconds: 0, fresh, counter };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((counter.start + rule.windowMs - time) / 1000)), fresh, counter };
}

export function createLimiter(options: { now?: () => number; maxKeys?: number } = {}): Limiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const clients = new Map<string, Counter>();
  const globals = new Map<string, Counter>();

  return {
    consume(client, global) {
      const time = now();
      if (!globals.has(global.name) && globals.size >= MAX_GLOBAL_BUDGETS) {
        throw new Error(`more than ${MAX_GLOBAL_BUDGETS} distinct global budgets`);
      }
      const c = check(clients.get(client.key), time, client.rule);
      const g = check(globals.get(global.name), time, global.rule);
      if (!c.allowed || !g.allowed) {
        const waits = [c, g].filter((x) => !x.allowed).map((x) => x.retryAfterSeconds);
        return { allowed: false, retryAfterSeconds: Math.max(...waits) };
      }

      if (c.fresh || !c.counter) {
        // New window: re-insert so insertion order follows window start
        clients.delete(client.key);
        clients.set(client.key, { start: time, count: 1 });
        if (clients.size > maxKeys) {
          const oldest = clients.keys().next();
          if (!oldest.done) clients.delete(oldest.value);
        }
      } else {
        c.counter.count++;
      }
      if (g.fresh || !g.counter) globals.set(global.name, { start: time, count: 1 });
      else g.counter.count++;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size: () => clients.size,
  };
}
