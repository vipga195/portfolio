// Decides whether a retrained brain is allowed to replace the published one. Pure: no I/O.
import { seededRng } from "../rng.ts";
import type { Env } from "./env.ts";
import { chooseAction } from "./qlearning.ts";
import type { QTable } from "./qlearning.ts";

export type EvalSummary = {
  // Average score over every game of every variant
  avg: number;
  // Average score per variant (for Snake: per grid size)
  perVariant: Record<number, number>;
};

// Greedy games (no exploration, no learning) on a FIXED list of seeds, so two brains are compared on exactly the same games.
export function evaluateSeeded<S>(
  env: Env<S>,
  table: QTable,
  variants: readonly number[],
  seeds: readonly number[],
): EvalSummary {
  const perVariant: Record<number, number> = {};
  let total = 0;
  let games = 0;
  for (const variant of variants) {
    let sum = 0;
    for (const seed of seeds) {
      const rng = seededRng(seed + variant * 7919);
      let state = env.reset(rng, variant);
      for (;;) {
        const { next, done } = env.step(state, chooseAction(table, env.encode(state), 0, rng));
        state = next;
        if (done) break;
      }
      sum += env.score(state);
    }
    perVariant[variant] = seeds.length > 0 ? sum / seeds.length : 0;
    total += sum;
    games += seeds.length;
  }
  return { avg: games > 0 ? total / games : 0, perVariant };
}

// Publish only when the candidate is not meaningfully worse: the overall average may drop by at most `tolerance`
// (0.05 = 5%), and no single variant may drop by more than twice that, so a brain cannot trade one grid size for another.
export function shouldPublish(candidate: EvalSummary, current: EvalSummary, tolerance: number): boolean {
  if (candidate.avg < current.avg * (1 - tolerance)) return false;
  for (const key of Object.keys(current.perVariant)) {
    const variant = Number(key);
    const now = candidate.perVariant[variant];
    if (now === undefined || now < current.perVariant[variant] * (1 - 2 * tolerance)) return false;
  }
  return true;
}
