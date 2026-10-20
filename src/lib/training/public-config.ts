// Settings of the public training API from the environment. Invalid values are rejected, never clamped.
import type { QuotaLimits } from "./jobs.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_BODY_BYTES = 4096;

// Request budgets: per client key, and global ones that do not depend on the (spoofable) client key
export type RateConfig = {
  postPerClient: number; // per 10 minutes
  postGlobal: number; // per minute
  readPerClient: number; // per minute (list + detail)
  readGlobal: number;
  brainPerClient: number;
  brainGlobal: number;
};

export type PublicApiConfig = { enabled: boolean; limits: QuotaLimits; rates: RateConfig; ipSalt: string | null };

export const DEFAULT_RATES: RateConfig = { postPerClient: 5, postGlobal: 60, readPerClient: 60, readGlobal: 600, brainPerClient: 20, brainGlobal: 120 };

type Range = { name: string; min: number; max: number; fallback: number };

const RANGES = {
  maxQueued: { name: "TRAINING_MAX_QUEUED", min: 1, max: 50, fallback: 5 },
  maxActive: { name: "TRAINING_MAX_ACTIVE", min: 1, max: 100, fallback: 6 },
  perClient: { name: "TRAINING_PER_CLIENT_DAILY", min: 1, max: 100, fallback: 3 },
  global: { name: "TRAINING_GLOBAL_DAILY", min: 1, max: 10_000, fallback: 100 },
} satisfies Record<string, Range>;

const RATE_RANGES = {
  postPerClient: { name: "TRAINING_POST_PER_CLIENT_10MIN", min: 1, max: 1000, fallback: DEFAULT_RATES.postPerClient },
  postGlobal: { name: "TRAINING_POST_GLOBAL_PER_MIN", min: 1, max: 100_000, fallback: DEFAULT_RATES.postGlobal },
  readPerClient: { name: "TRAINING_READ_PER_CLIENT_PER_MIN", min: 1, max: 10_000, fallback: DEFAULT_RATES.readPerClient },
  readGlobal: { name: "TRAINING_READ_GLOBAL_PER_MIN", min: 1, max: 1_000_000, fallback: DEFAULT_RATES.readGlobal },
  brainPerClient: { name: "TRAINING_BRAIN_PER_CLIENT_PER_MIN", min: 1, max: 10_000, fallback: DEFAULT_RATES.brainPerClient },
  brainGlobal: { name: "TRAINING_BRAIN_GLOBAL_PER_MIN", min: 1, max: 1_000_000, fallback: DEFAULT_RATES.brainGlobal },
} satisfies Record<keyof RateConfig, Range>;

function read(env: Record<string, string | undefined>, { name, min, max, fallback }: Range): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

// Everything is off unless TRAINING_ENABLED is exactly "true"
export function isTrainingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TRAINING_ENABLED === "true";
}

export function readPublicConfig(env: Record<string, string | undefined> = process.env): PublicApiConfig {
  return {
    enabled: isTrainingEnabled(env),
    limits: {
      maxQueued: read(env, RANGES.maxQueued),
      maxActive: read(env, RANGES.maxActive),
      perClient: read(env, RANGES.perClient),
      global: read(env, RANGES.global),
      windowMs: DAY_MS,
    },
    rates: {
      postPerClient: read(env, RATE_RANGES.postPerClient),
      postGlobal: read(env, RATE_RANGES.postGlobal),
      readPerClient: read(env, RATE_RANGES.readPerClient),
      readGlobal: read(env, RATE_RANGES.readGlobal),
      brainPerClient: read(env, RATE_RANGES.brainPerClient),
      brainGlobal: read(env, RATE_RANGES.brainGlobal),
    },
    ipSalt: env.TRAINING_IP_SALT ? env.TRAINING_IP_SALT : null,
  };
}

// Used while the flag is off: never read from, every handler answers 404 first
export const DISABLED_CONFIG: PublicApiConfig = {
  enabled: false,
  limits: { maxQueued: 1, maxActive: 1, perClient: 1, global: 1, windowMs: DAY_MS },
  rates: DEFAULT_RATES,
  ipSalt: null,
};
