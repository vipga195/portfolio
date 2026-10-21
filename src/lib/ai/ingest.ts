// Learning from games that other people played: turn submitted games into transitions, apply them to a COPY of the
// published Q-table, and only mark the result publishable if it passes the evaluation gate. Pure: no I/O.
import type { Env, Transition } from "./env.ts";
import { evaluateSeeded, shouldPublish } from "./gate.ts";
import type { EvalSummary } from "./gate.ts";
import { createQTable, updateQ } from "./qlearning.ts";
import type { QTable } from "./qlearning.ts";

export function cloneQTable(table: QTable): QTable {
  const copy = createQTable(table.stateCount, table.actionCount);
  copy.values.set(table.values);
  return copy;
}

// Same update the agent uses while training, applied to transitions someone else generated (Q-learning is off-policy)
export function ingestTransitions<S>(
  env: Env<S>,
  table: QTable,
  transitions: readonly Transition<S>[],
  alpha: number,
  gamma: number,
): void {
  for (const t of transitions) {
    updateQ(table, env.encode(t.state), t.action, t.reward, env.encode(t.next), t.done, alpha, gamma);
  }
}

export type SubmittedGame = {
  // Who submitted it (account, session...). Used to stop one source from dominating a batch.
  source: string;
  gridSize: number;
  seed: number;
  moves: string;
};

export type TransitionsOutcome<S> =
  | { ok: true; transitions: Transition<S>[] }
  | { ok: false; reason: string };

export type PipelineOptions = {
  alpha: number;
  gamma: number;
  // Games beyond this many per source in one batch are ignored
  maxGamesPerSource: number;
  evalVariants: number[];
  evalSeeds: number[];
  // See shouldPublish
  tolerance: number;
};

export type PipelineReport = {
  gamesUsed: number;
  transitionsLearned: number;
  // Why games were not used: reason -> how many
  rejected: Record<string, number>;
  before: EvalSummary;
  after: EvalSummary;
  publish: boolean;
};

export function runPipeline<S>(
  env: Env<S>,
  current: QTable,
  games: readonly SubmittedGame[],
  toTransitions: (game: SubmittedGame) => TransitionsOutcome<S>,
  options: PipelineOptions,
): { candidate: QTable; report: PipelineReport } {
  if (options.evalSeeds.length === 0) throw new Error("evalSeeds must not be empty: the gate needs games to compare on");

  const candidate = cloneQTable(current);   // the published brain is never modified
  const rejected: Record<string, number> = {};
  const reject = (reason: string): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  const perSource = new Map<string, number>();
  const seenSeeds = new Set<number>();
  let gamesUsed = 0;
  let transitionsLearned = 0;

  for (const game of games) {
    const fromSource = perSource.get(game.source) ?? 0;
    if (fromSource >= options.maxGamesPerSource) {
      reject("source limit");
      continue;
    }
    if (seenSeeds.has(game.seed)) {
      reject("duplicate seed");
      continue;
    }
    const outcome = toTransitions(game);
    if (!outcome.ok) {
      reject(outcome.reason);
      continue;
    }
    seenSeeds.add(game.seed);
    perSource.set(game.source, fromSource + 1);
    ingestTransitions(env, candidate, outcome.transitions, options.alpha, options.gamma);
    gamesUsed++;
    transitionsLearned += outcome.transitions.length;
  }

  const before = evaluateSeeded(env, current, options.evalVariants, options.evalSeeds);
  const after = evaluateSeeded(env, candidate, options.evalVariants, options.evalSeeds);
  // Nothing learned means nothing new to publish
  const publish = gamesUsed > 0 && shouldPublish(after, before, options.tolerance);
  return { candidate, report: { gamesUsed, transitionsLearned, rejected, before, after, publish } };
}
