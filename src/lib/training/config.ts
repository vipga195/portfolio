// Trainer settings from the environment. Invalid values are rejected, never clamped.
export const HEARTBEAT_MS = 5000;

export type TrainerConfig = { maxRuntimeMs: number; pollMs: number; staleMs: number; workerMb: number };

type Range = { name: string; min: number; max: number; fallback: number };

const RANGES = {
  maxRuntimeMs: { name: "TRAINER_MAX_RUNTIME_MS", min: 1_000, max: 86_400_000, fallback: 600_000 },
  pollMs: { name: "TRAINER_POLL_MS", min: 100, max: 60_000, fallback: 2000 },
  // A run is "lost" only after several missed heartbeats
  staleMs: { name: "TRAINER_STALE_MS", min: 6 * HEARTBEAT_MS, max: 86_400_000, fallback: 60_000 },
  workerMb: { name: "TRAINER_WORKER_MB", min: 64, max: 4096, fallback: 512 },
} satisfies Record<keyof TrainerConfig, Range>;

function read(env: Record<string, string | undefined>, { name, min, max, fallback }: Range): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

export function readTrainerConfig(env: Record<string, string | undefined> = process.env): TrainerConfig {
  return {
    maxRuntimeMs: read(env, RANGES.maxRuntimeMs),
    pollMs: read(env, RANGES.pollMs),
    staleMs: read(env, RANGES.staleMs),
    workerMb: read(env, RANGES.workerMb),
  };
}
