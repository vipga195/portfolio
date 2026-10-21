// One learning cycle for Snake: take the pending player games, learn from the valid ones into a COPY of the published
// brain, and publish the result only if the evaluation gate accepts it. All I/O goes through the injected deps.
import { evaluateSeeded, shouldPublish } from "../ai/gate.ts";
import { brainEpisodes, parseBrain, toBrain } from "../ai/brain.ts";
import { runPipeline } from "../ai/ingest.ts";
import type { PipelineOptions, PipelineReport, SubmittedGame } from "../ai/ingest.ts";
import type { QTable } from "../ai/qlearning.ts";
import { snakeEnv } from "../game/snake-env.ts";
import { snakeTransitionsFromMoves } from "../game/snake-transitions.ts";
import type { SubmissionStore } from "../training/submissions.ts";

export const GAME_ID = "snake";
// Small steps: a batch of player games nudges the table instead of rewriting it (see simulate-learning)
export const ALPHA = 0.05;
export const GAMMA = 0.9;
export const MAX_GAMES_PER_SOURCE = 5;
export const MAX_BATCH = 500;
export const EVAL_SEEDS: number[] = Array.from({ length: 100 }, (_, i) => i + 1);
export const TOLERANCE = 0.05;

export type LearnerDeps = {
  store: SubmissionStore;
  loadBuiltinBrain: () => unknown;
  now: () => Date;
};

export type LearnOptions = Partial<PipelineOptions> & { maxBatch?: number };

export type LearnReport = {
  at: string;
  // Where the starting table came from
  base: "published" | "builtin";
  baseBrainId: number | null;
  pending: number;
  gamesUsed: number;
  transitionsLearned: number;
  // Reason -> count, for games the server refused (permanently) or skipped (left pending)
  rejected: Record<string, number>;
  // Games that stay pending for the next run (source/seed limits of this batch)
  deferred: number;
  before: PipelineReport["before"] | null;
  after: PipelineReport["after"] | null;
  gatePassed: boolean;
  // Candidate vs the BUILT-IN brain (fixed floor), so repeated small drops cannot compound
  floorPassed: boolean;
  published: boolean;
};

function loadBase(deps: LearnerDeps, published: Awaited<ReturnType<SubmissionStore["getPublished"]>>) {
  if (published && published.featuresVersion === snakeEnv.featuresVersion) {
    const table = parseBrain(published.data, snakeEnv);
    if (table) return { table, source: "published" as const, brainId: published.brainId, data: published.data };
  }
  const data = deps.loadBuiltinBrain();
  const table = parseBrain(data, snakeEnv);
  if (!table) throw new Error("built-in snake brain is missing or does not match the current features version");
  return { table, source: "builtin" as const, brainId: null, data };
}

export async function learnOnce(deps: LearnerDeps, options: LearnOptions = {}): Promise<LearnReport> {
  const { maxBatch = MAX_BATCH, ...overrides } = options;
  const pipelineOptions: PipelineOptions = {
    alpha: ALPHA,
    gamma: GAMMA,
    maxGamesPerSource: MAX_GAMES_PER_SOURCE,
    evalVariants: snakeEnv.evalVariants.map((v) => v.variant),
    evalSeeds: EVAL_SEEDS,
    tolerance: TOLERANCE,
    ...overrides,
  };

  const base = loadBase(deps, await deps.store.getPublished(GAME_ID));
  const pending = await deps.store.listPending(GAME_ID, maxBatch);
  const empty: LearnReport = {
    at: deps.now().toISOString(),
    base: base.source,
    baseBrainId: base.brainId,
    pending: pending.length,
    gamesUsed: 0,
    transitionsLearned: 0,
    rejected: {},
    deferred: 0,
    before: null,
    after: null,
    gatePassed: false,
    floorPassed: false,
    published: false,
  };
  if (pending.length === 0) return empty;

  // Remember what the pipeline decided for each game, so the store is updated per game and not just per reason
  const games = new Map<SubmittedGame, number>();
  for (const p of pending) {
    games.set({ source: p.sourceHash, gridSize: Number(p.variant), seed: p.seed, moves: p.moves }, p.id);
  }
  const usedIds: number[] = [];
  const rejected: { id: number; reason: string }[] = [];
  const { candidate, report } = runPipeline(
    snakeEnv,
    base.table,
    [...games.keys()],
    (game) => {
      const outcome = snakeTransitionsFromMoves(game.gridSize, game.seed, game.moves);
      const id = games.get(game) as number;
      if (outcome.ok) usedIds.push(id);
      else rejected.push({ id, reason: outcome.reason });
      return outcome;
    },
    pipelineOptions,
  );

  // Fixed floor: the built-in brain is evaluated once per run with the same variants/seeds
  const builtinTable = parseBrain(deps.loadBuiltinBrain(), snakeEnv);
  if (!builtinTable) throw new Error("built-in snake brain is missing or does not match the current features version");
  const builtinEval = evaluateSeeded(snakeEnv, builtinTable, pipelineOptions.evalVariants, pipelineOptions.evalSeeds);
  const floorPassed = shouldPublish(report.after, builtinEval, pipelineOptions.tolerance);
  const publish = report.publish && floorPassed && report.gamesUsed > 0;
  await deps.store.recordGeneration({
    game: GAME_ID,
    usedIds,
    rejected,
    brain: publish ? buildBrain(candidate, report, base.data) : null,
  });

  return {
    ...empty,
    gamesUsed: report.gamesUsed,
    transitionsLearned: report.transitionsLearned,
    rejected: report.rejected,
    deferred: pending.length - usedIds.length - rejected.length,
    before: report.before,
    after: report.after,
    gatePassed: report.publish,
    floorPassed,
    published: publish,
  };
}

function buildBrain(candidate: QTable, report: PipelineReport, baseData: unknown) {
  // Episodes counts what the table was trained on before; player games are not training episodes
  return {
    data: toBrain(snakeEnv, candidate, brainEpisodes(baseData)),
    eval: report,
    featuresVersion: snakeEnv.featuresVersion,
    episodes: brainEpisodes(baseData),
  };
}
