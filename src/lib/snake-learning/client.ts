// Browser-side helpers for the learning API. Browser-safe on purpose: no node:crypto, no server modules.
// Every function here swallows failures: learning is optional and must never break the game.
import type { Direction, GameState } from "../game/snake.ts";
import { encodeMoves, maxMoves } from "../game/replay.ts";

export type FetchLike = typeof fetch;

const SESSION_URL = "/api/learning/session";
const GAMES_URL = "/api/learning/games";
const BRAIN_URL = "/api/learning/brain";
export const REQUEST_TIMEOUT_MS = 3000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// fetch with a hard timeout; the caller handles the thrown error
async function fetchWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A reply that arrives after the abort must not win: race the fetch against the signal as well
function withAbort<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}

export type ClientSession = { token: string; seed: number };

// Null on anything but a well-formed 200 (disabled API, rate limit, network error, timeout)
export async function requestSession(
  gridSize: number,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<ClientSession | null> {
  try {
    const res = await withAbort(
      fetchWithTimeout(fetchImpl, SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gridSize }),
      }, timeoutMs),
      timeoutMs,
    );
    if (res.status !== 200) return null;
    const body: unknown = await withAbort(res.json(), timeoutMs);
    if (!isRecord(body)) return null;
    const { token, seed } = body;
    if (typeof token !== "string" || token.length === 0) return null;
    if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed >= 4294967296) return null;
    return { token, seed };
  } catch {
    return null;
  }
}

// Fire and forget: true only when the server accepted the game (202)
export async function submitMoves(
  token: string,
  moves: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<boolean> {
  try {
    const res = await withAbort(
      fetchWithTimeout(fetchImpl, GAMES_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, moves }),
        keepalive: true,
      }, timeoutMs),
      timeoutMs,
    );
    return res.status === 202;
  } catch {
    return false;
  }
}

// The raw brain JSON (caller validates it with parseBrain) or null when none is published / anything fails
export async function loadPublishedBrain(
  featuresVersion: number,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  try {
    const res = await withAbort(
      fetchWithTimeout(fetchImpl, `${BRAIN_URL}?featuresVersion=${encodeURIComponent(String(featuresVersion))}`, {}, timeoutMs),
      timeoutMs,
    );
    if (res.status !== 200) return null;
    const body: unknown = await withAbort(res.json(), timeoutMs);
    if (!isRecord(body) || body.brain === undefined || body.brain === null) return null;
    return body.brain;
  } catch {
    return null;
  }
}

// Appends the direction requested on this tick, exactly what `step` is about to receive.
// Returns false (and records nothing) when the game is already over or the log would exceed what the server accepts;
// the caller then drops the session instead of submitting a game that cannot replay.
export function recordMove(moves: Direction[], dir: Direction, state: GameState): boolean {
  if (!state.alive || moves.length >= maxMoves(state.gridSize)) return false;
  moves.push(dir);
  return true;
}

export function encodeRecordedMoves(moves: readonly Direction[]): string {
  return encodeMoves(moves);
}
