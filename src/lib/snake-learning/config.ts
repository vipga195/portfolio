// Settings of the public learning API from the environment. Invalid values are rejected, never clamped.
// The secret is NOT part of the config: only the wiring layer reads it (see readSecret) and passes it to the handlers.
import type { SubmissionLimits } from "../training/submissions.ts";
import { MIN_SECRET_LENGTH } from "./keys.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;

// Request budgets: per client key and global ones that do not depend on the (spoofable) client key. All per minute.
export type LearningRates = {
  sessionPerClient: number;
  sessionGlobal: number;
  gamesPerClient: number;
  gamesGlobal: number;
  brainPerClient: number;
  brainGlobal: number;
};

export type LearningConfig = { enabled: boolean; limits: SubmissionLimits; rates: LearningRates };

type Range = { name: string; min: number; max: number; fallback: number };

const LIMIT_RANGES = {
  perSource: { name: "LEARNING_PER_SOURCE_DAILY", min: 1, max: 1000, fallback: 20 },
  global: { name: "LEARNING_GLOBAL_DAILY", min: 1, max: 1_000_000, fallback: 2000 },
  maxPending: { name: "LEARNING_MAX_PENDING", min: 1, max: 100_000, fallback: 1000 },
  windowMs: { name: "LEARNING_WINDOW_MS", min: 60_000, max: 7 * DAY_MS, fallback: DAY_MS },
} satisfies Record<keyof SubmissionLimits, Range>;

const RATE_RANGES = {
  sessionPerClient: { name: "LEARNING_SESSION_PER_CLIENT_PER_MIN", min: 1, max: 10_000, fallback: 10 },
  sessionGlobal: { name: "LEARNING_SESSION_GLOBAL_PER_MIN", min: 1, max: 1_000_000, fallback: 300 },
  gamesPerClient: { name: "LEARNING_GAMES_PER_CLIENT_PER_MIN", min: 1, max: 10_000, fallback: 10 },
  gamesGlobal: { name: "LEARNING_GAMES_GLOBAL_PER_MIN", min: 1, max: 1_000_000, fallback: 300 },
  brainPerClient: { name: "LEARNING_BRAIN_PER_CLIENT_PER_MIN", min: 1, max: 10_000, fallback: 20 },
  brainGlobal: { name: "LEARNING_BRAIN_GLOBAL_PER_MIN", min: 1, max: 1_000_000, fallback: 600 },
} satisfies Record<keyof LearningRates, Range>;

function read(env: Record<string, string | undefined>, { name, min, max, fallback }: Range): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

// Everything is off unless LEARNING_ENABLED is exactly "true"
export function isLearningEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LEARNING_ENABLED === "true";
}

export function readLearningConfig(env: Record<string, string | undefined> = process.env): LearningConfig {
  return {
    enabled: isLearningEnabled(env),
    limits: {
      perSource: read(env, LIMIT_RANGES.perSource),
      global: read(env, LIMIT_RANGES.global),
      maxPending: read(env, LIMIT_RANGES.maxPending),
      windowMs: read(env, LIMIT_RANGES.windowMs),
    },
    rates: {
      sessionPerClient: read(env, RATE_RANGES.sessionPerClient),
      sessionGlobal: read(env, RATE_RANGES.sessionGlobal),
      gamesPerClient: read(env, RATE_RANGES.gamesPerClient),
      gamesGlobal: read(env, RATE_RANGES.gamesGlobal),
      brainPerClient: read(env, RATE_RANGES.brainPerClient),
      brainGlobal: read(env, RATE_RANGES.brainGlobal),
    },
  };
}

// Only called by the wiring layer, and only when the flag is on
export function readSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.LEARNING_SECRET;
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`LEARNING_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

// Used while the flag is off: never read from, every handler answers 404 first
export const DISABLED_LEARNING_CONFIG: LearningConfig = {
  enabled: false,
  limits: { perSource: 1, global: 1, maxPending: 1, windowMs: DAY_MS },
  rates: {
    sessionPerClient: 1,
    sessionGlobal: 1,
    gamesPerClient: 1,
    gamesGlobal: 1,
    brainPerClient: 1,
    brainGlobal: 1,
  },
};
