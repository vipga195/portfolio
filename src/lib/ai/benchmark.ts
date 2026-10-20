// Deterministic benchmark: the same model + seed always gives identical numbers, and every algorithm
// is measured on the same sequence of games per variant.
import type { Game, Policy } from "./game.ts";
import { seededRng } from "../rng.ts";

export const BENCHMARK_SEED = 20260101;
export const BENCHMARK_GAMES = 100;
// Hard safety against endless games; games are expected to end on their own (death, win, stuck limit)
const DEFAULT_MAX_STEPS_PER_GAME = 50_000_000;

export type VariantResult = { label: string; avg: number; best: number; median: number; games: number };
export type BenchmarkResult = { variants: VariantResult[]; overall: number };

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function benchmarkPolicy<S>(
  game: Game<S>,
  makePolicy: (rng: () => number) => Policy<S>,
  options: { games?: number; seed?: number; maxSteps?: number } = {},
): BenchmarkResult {
  const games = options.games ?? BENCHMARK_GAMES;
  const seed = options.seed ?? BENCHMARK_SEED;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS_PER_GAME;
  if (!Number.isInteger(games) || games < 1) throw new Error("games must be a positive integer");
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("maxSteps must be a positive integer");
  if (game.evalVariants.length === 0) throw new Error(`Game "${game.id}" has no evalVariants to benchmark`);

  const variants = game.evalVariants.map(({ label, variant }, v): VariantResult => {
    const base = (seed + v * 1000003) >>> 0;
    // Two independent streams: game creation must not depend on how often the policy draws random numbers
    const gameRng = seededRng(base);
    const policy = makePolicy(seededRng((base ^ 0x9e3779b9) >>> 0));
    const scores: number[] = [];
    for (let g = 0; g < games; g++) {
      let state = game.reset(gameRng, variant);
      for (let steps = 0; ; steps++) {
        if (steps >= maxSteps) throw new Error(`Game "${game.id}" (${label}) did not end within ${maxSteps} steps`);
        const { next, done } = game.step(state, policy(state));
        state = next;
        if (done) break;
      }
      scores.push(game.score(state));
    }
    const sorted = [...scores].sort((a, b) => a - b);
    return {
      label,
      avg: scores.reduce((sum, s) => sum + s, 0) / games,
      best: sorted[sorted.length - 1],
      median: median(sorted),
      games,
    };
  });
  return { variants, overall: variants.reduce((sum, r) => sum + r.avg, 0) / variants.length };
}
