// A training algorithm as the platform sees it. Generic over the game: the algorithm picks the representation it needs.
import type { Game, Policy } from "./game.ts";

export type AlgorithmId = "q-learning" | "dqn";

export type TrainProgress = { episode: number; epsilon: number; avg: number; best: number; loss?: number };

export type TrainContext<M> = {
  episodes: number;
  rng: () => number;
  // Episodes between progress reports; default about episodes / 20
  reportEvery?: number;
  onProgress?: (info: TrainProgress) => void;
  // Resume from a previously trained model
  initial?: M;
};

// Method syntax on purpose: it lets an Algorithm<P, M> be stored in a registry typed Algorithm<unknown, unknown>.
export type Algorithm<P, M> = {
  id: AlgorithmId;
  label: string;
  defaultParams: P;
  // Episode cap for the PUBLIC API boundary only (see parseEpisodes). train() does not enforce it: CLI/admin runs may exceed it.
  PUBLIC_MAX_EPISODES: number;
  // Untrusted input: whitelist of known keys, range-checked, nothing clamped. Missing keys take the default; null when invalid.
  parseParams(input: unknown): P | null;
  // Brain file id (public/brains/<id>.json) for this algorithm on this game
  brainGameId(game: Game<unknown>): string;
  // Throws when context.episodes is not a positive integer. `context.initial` is never modified: training works on a copy.
  train<S>(game: Game<S>, params: P, context: TrainContext<M>): M;
  // Greedy policy; ties between equally good actions are broken with `rng`
  createPolicy<S>(model: M, game: Game<S>, rng: () => number): Policy<S>;
  // Exactly the brain JSON shape the app loads
  serialize(model: M, game: Game<unknown>, episodes: number): unknown;
  // Validates untrusted JSON against the game (id, features version, sizes); null when it does not fit
  parse(input: unknown, game: Game<unknown>): M | null;
};

// Shared helpers for parseParams
export function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function hasOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

// Own property or the fallback: inherited properties never count
export function pick(input: Record<string, unknown>, key: string, fallback: unknown): unknown {
  return Object.hasOwn(input, key) ? input[key] : fallback;
}

export function inRange(value: unknown, min: number, max: number, integer: boolean): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}

// Episodes from untrusted input: integer in 1..algorithm.PUBLIC_MAX_EPISODES, otherwise null
export function parseEpisodes(algorithm: { PUBLIC_MAX_EPISODES: number }, input: unknown): number | null {
  return inRange(input, 1, algorithm.PUBLIC_MAX_EPISODES, true) ? input : null;
}

// For train(): any positive integer is fine here (the public cap is enforced by parseEpisodes at the API boundary)
export function assertEpisodes(episodes: number): void {
  if (!Number.isInteger(episodes) || episodes < 1) throw new Error("episodes must be a positive integer");
}
