const rateLimitMap = new Map<string, number[]>();
const MAX_REQUESTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = (rateLimitMap.get(key) ?? []).filter((ts) => ts > windowStart);

  if (timestamps.length >= MAX_REQUESTS) {
    return true;
  }

  timestamps.push(now);
  rateLimitMap.set(key, timestamps);

  // Prune expired entries when map size exceeds 1000
  if (rateLimitMap.size > 1000) {
    const keysToDelete: string[] = [];
    for (const [k, v] of rateLimitMap.entries()) {
      if (v.filter((ts) => ts > windowStart).length === 0) {
        keysToDelete.push(k);
      }
    }
    keysToDelete.forEach((k) => rateLimitMap.delete(k));
  }

  return false;
}
