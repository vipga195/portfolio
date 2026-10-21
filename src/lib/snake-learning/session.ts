// Signed game sessions: the server hands out (grid size, seed) inside a token it can verify later WITHOUT storing it,
// so a submitted game is known to be for a seed this server issued. Server-only (node:crypto).
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { MAX_GRID_SIZE, MIN_GRID_SIZE } from "../game/snake.ts";
import { deriveKey } from "./keys.ts";

const TOKEN_VERSION = "v1";
const UINT32 = 4294967296;
const SESSION_KEY_PURPOSE = "snake-session";
// A big game can last ~15 minutes including pauses; one hour leaves plenty of room
export const SESSION_MAX_AGE_SEC = 60 * 60;
// Tolerated difference between the clock that issued the token and the clock that checks it
const CLOCK_SKEW_SEC = 60;
const MAX_TOKEN_CHARS = 200;
// base64url of a 32-byte HMAC-SHA256 digest
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGITS_PATTERN = /^\d{1,10}$/;

export type Session = {
  gridSize: number;
  // Unsigned 32-bit seed of the game (see createInitialState)
  seed: number;
  // Seconds since the epoch
  issuedAt: number;
};

export type VerifyResult = { ok: true; session: Session } | { ok: false; reason: string };

function isValidSession(session: Session): boolean {
  return (
    Number.isInteger(session.gridSize) &&
    session.gridSize >= MIN_GRID_SIZE &&
    session.gridSize <= MAX_GRID_SIZE &&
    Number.isInteger(session.seed) &&
    session.seed >= 0 &&
    session.seed < UINT32 &&
    Number.isInteger(session.issuedAt) &&
    session.issuedAt >= 0
  );
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", deriveKey(secret, SESSION_KEY_PURPOSE)).update(payload).digest();
}

// Token format: v1.<gridSize>.<seed>.<issuedAt>.<signature>, signature = HMAC-SHA256 over everything before it
export function signSession(session: Session, secret: string): string {
  if (!isValidSession(session)) throw new Error("cannot sign an invalid session");
  const payload = `${TOKEN_VERSION}.${session.gridSize}.${session.seed}.${session.issuedAt}`;
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

// A fresh session with an unpredictable seed (crypto.randomInt, not Math.random)
export function createSession(gridSize: number, nowSec: number, secret: string): { session: Session; token: string } {
  const session: Session = { gridSize, seed: randomInt(0, UINT32), issuedAt: nowSec };
  return { session, token: signSession(session, secret) };
}

// The token comes from a client: every failure is a result, never an exception (a bad secret is a server bug and throws)
export function verifySessionToken(
  token: unknown,
  secret: string,
  nowSec: number,
  maxAgeSec: number = SESSION_MAX_AGE_SEC,
): VerifyResult {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, reason: "malformed token" };
  }
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: "malformed token" };
  const [, gridText, seedText, issuedText, signatureText] = parts;
  if (![gridText, seedText, issuedText].every((p) => DIGITS_PATTERN.test(p)) || !SIGNATURE_PATTERN.test(signatureText)) {
    return { ok: false, reason: "malformed token" };
  }

  // Signature first: nothing else in the token is trusted until it matches
  const payload = `${TOKEN_VERSION}.${gridText}.${seedText}.${issuedText}`;
  const expected = signature(payload, secret);
  const given = Buffer.from(signatureText, "base64url");
  // The last base64url character carries 2 padding bits that decoding ignores: require the canonical spelling so a
  // session has exactly one valid token string
  if (given.toString("base64url") !== signatureText || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad signature" };
  }

  const session: Session = { gridSize: Number(gridText), seed: Number(seedText), issuedAt: Number(issuedText) };
  if (!isValidSession(session)) return { ok: false, reason: "session values out of range" };
  if (nowSec - session.issuedAt > maxAgeSec) return { ok: false, reason: "token expired" };
  if (session.issuedAt - nowSec > CLOCK_SKEW_SEC) return { ok: false, reason: "token issued in the future" };
  return { ok: true, session };
}
