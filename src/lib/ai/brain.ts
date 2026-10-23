import { createQTable } from "./qlearning.ts";
import type { QTable } from "./qlearning.ts";

export const BRAIN_VERSION = 1;

export type Brain = {
  game: string;
  // File format version of the brain JSON itself
  version: number;
  // Version of the game's state encoding (Env.featuresVersion) the table was trained with
  featuresVersion: number;
  stateCount: number;
  actionCount: number;
  episodes: number;
  q: number[];
};

// Env satisfies this, so an Env can be passed wherever a BrainShape is expected
export type BrainShape = { id: string; stateCount: number; actionCount: number; featuresVersion: number };

export function toBrain(shape: BrainShape, table: QTable, episodes: number): Brain {
  return {
    game: shape.id,
    version: BRAIN_VERSION,
    featuresVersion: shape.featuresVersion,
    stateCount: table.stateCount,
    actionCount: table.actionCount,
    episodes,
    q: Array.from(table.values, (v) => Math.round(v * 1000) / 1000),
  };
}

// Episodes already trained, read from a saved brain file (works for the Q-table and DQN formats).
// 0 when the field is missing or invalid, so a resumed run never inherits a bogus count.
export function brainEpisodes(input: unknown): number {
  if (typeof input !== "object" || input === null) return 0;
  const { episodes } = input as Partial<Record<keyof Brain, unknown>>;   // single field, checked below
  return typeof episodes === "number" && Number.isInteger(episodes) && episodes >= 0 ? episodes : 0;
}

// A brain file is loaded over the network, so validate it against the game that wants to use it
export function parseBrain(input: unknown, shape: BrainShape): QTable | null {
  if (typeof input !== "object" || input === null) return null;
  const { game, version, featuresVersion, stateCount, actionCount, q } = input as Partial<Record<keyof Brain, unknown>>; // fields checked one by one below
  if (game !== shape.id || version !== BRAIN_VERSION) return null;
  if (featuresVersion !== shape.featuresVersion) return null;   // trained with a different state encoding
  if (stateCount !== shape.stateCount || actionCount !== shape.actionCount) return null;
  if (!Array.isArray(q) || q.length !== shape.stateCount * shape.actionCount) return null;
  if (!q.every((v) => typeof v === "number" && Number.isFinite(v))) return null;

  const table = createQTable(shape.stateCount, shape.actionCount);
  table.values.set(q);
  return table;
}
