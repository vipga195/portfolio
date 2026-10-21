// Simulates visitors submitting games and runs the whole learning pipeline on them, on this machine only (no server, no DB).
// It answers: how much does the brain change, and does the gate accept or reject the result?
//
// Usage: node scripts/simulate-learning.ts [games] [--noise 0.1] [--bad 0.2] [--forged 20] [--alpha 0.05]
//                                          [--sources 20] [--per-source 5] [--seed 2026]
//   games      games submitted by "normal" players (default 300)
//   --noise    chance a normal player makes a random move instead of the brain's choice (default 0.1)
//   --bad      extra games from players who move at random, as a fraction of `games` (default 0.2)
//   --forged   games with invented extra moves after the snake died (default 20); the server must reject them
import { readFileSync } from "node:fs";

import { parseBrain } from "../src/lib/ai/brain.ts";
import { runPipeline } from "../src/lib/ai/ingest.ts";
import type { PipelineOptions, SubmittedGame } from "../src/lib/ai/ingest.ts";
import { chooseAction } from "../src/lib/ai/qlearning.ts";
import { encodeMoves, maxMoves } from "../src/lib/game/replay.ts";
import { actionToDirection, snakeEnv, snakeFeatures } from "../src/lib/game/snake-env.ts";
import type { SnakeEnvState } from "../src/lib/game/snake-env.ts";
import { snakeTransitionsFromMoves } from "../src/lib/game/snake-transitions.ts";
import { MIN_GRID_SIZE, createInitialState } from "../src/lib/game/snake.ts";
import type { Direction } from "../src/lib/game/snake.ts";
import { seededRng } from "../src/lib/rng.ts";

const BRAIN_FILE = "public/brains/snake.json";
// Visitors play on the grid sizes the UI offers by default; evaluation also covers the large ones
const PLAYER_MAX_GRID = 20;
const EVAL_SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

function numberOption(args: string[], name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = Number(args[i + 1]);
  if (!Number.isFinite(value)) {
    console.error(`--${name} needs a number`);
    process.exit(1);
  }
  return value;
}

function main(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const games = Number(positional[0] ?? 300);
  const noise = numberOption(args, "noise", 0.1);
  const bad = numberOption(args, "bad", 0.2);
  const forged = numberOption(args, "forged", 20);
  const alpha = numberOption(args, "alpha", 0.05);
  const sources = numberOption(args, "sources", 20);
  const perSource = numberOption(args, "per-source", 5);
  const rng = seededRng(numberOption(args, "seed", 2026));

  const table = parseBrain(JSON.parse(readFileSync(BRAIN_FILE, "utf8")), snakeEnv);
  if (!table) {
    console.error(`no valid brain at ${BRAIN_FILE}`);
    process.exit(1);
  }

  // Plays one game live and returns what a client would submit: the direction requested on every tick
  const play = (gridSize: number, seed: number, randomness: number): string => {
    let state: SnakeEnvState = { game: createInitialState(gridSize, seed), sinceFood: 0 };
    const directions: Direction[] = [];
    while (directions.length < maxMoves(gridSize)) {
      const action = chooseAction(table, snakeFeatures(state.game), randomness, rng);
      directions.push(actionToDirection(state.game.dir, action));
      const { next, done } = snakeEnv.step(state, action);
      if (done) break;
      state = next;
    }
    return encodeMoves(directions);
  };
  const randomGrid = (): number => MIN_GRID_SIZE + Math.floor(rng() * (PLAYER_MAX_GRID - MIN_GRID_SIZE + 1));
  const randomSeedValue = (): number => Math.floor(rng() * 4294967296);

  const submitted: SubmittedGame[] = [];
  for (let i = 0; i < games; i++) {
    const gridSize = randomGrid();
    const seed = randomSeedValue();
    submitted.push({ source: `player-${i % sources}`, gridSize, seed, moves: play(gridSize, seed, noise) });
  }
  const badGames = Math.round(games * bad);
  for (let i = 0; i < badGames; i++) {
    const gridSize = randomGrid();
    const seed = randomSeedValue();
    submitted.push({ source: `random-${i % sources}`, gridSize, seed, moves: play(gridSize, seed, 1) });
  }
  for (let i = 0; i < forged; i++) {
    const gridSize = randomGrid();
    const seed = randomSeedValue();
    // A real game that ended, plus invented moves after it: this is what a forged submission looks like
    submitted.push({ source: `forger-${i % 3}`, gridSize, seed, moves: play(gridSize, seed, 1) + "dddd" });
  }
  console.log(`submitted: ${games} normal (noise ${noise}), ${badGames} random players, ${forged} forged`);

  const options: PipelineOptions = {
    alpha,
    gamma: 0.9,
    maxGamesPerSource: perSource,
    evalVariants: snakeEnv.evalVariants.map((v) => v.variant),
    evalSeeds: EVAL_SEEDS,
    tolerance: 0.05,
  };
  const startedAt = Date.now();
  const { candidate, report } = runPipeline(
    snakeEnv,
    table,
    submitted,
    (g) => snakeTransitionsFromMoves(g.gridSize, g.seed, g.moves),
    options,
  );

  console.log(`games used: ${report.gamesUsed}, transitions learned: ${report.transitionsLearned}`);
  console.log("games not used:", report.rejected);

  // How much did the table actually move? A change in the numbers matters only if it flips a greedy choice.
  let touched = 0;
  let sumDelta = 0;
  let maxDelta = 0;
  for (let i = 0; i < table.values.length; i++) {
    const delta = Math.abs(candidate.values[i] - table.values[i]);
    if (delta > 0) touched++;
    sumDelta += delta;
    maxDelta = Math.max(maxDelta, delta);
  }
  let flipped = 0;
  for (let s = 0; s < table.stateCount; s++) {
    const best = (t: typeof table): number => {
      let arg = 0;
      for (let a = 1; a < t.actionCount; a++) if (t.values[s * t.actionCount + a] > t.values[s * t.actionCount + arg]) arg = a;
      return arg;
    };
    if (best(table) !== best(candidate)) flipped++;
  }
  console.log(
    `table change: ${touched}/${table.values.length} entries moved, mean |delta| ${(sumDelta / Math.max(1, touched)).toFixed(3)}, ` +
      `max |delta| ${maxDelta.toFixed(2)}, greedy choice flipped in ${flipped} of ${table.stateCount} states`,
  );
  console.log(`evaluation on ${EVAL_SEEDS.length} fixed seeds per grid size (greedy):`);
  for (const { label, variant } of snakeEnv.evalVariants) {
    const b = report.before.perVariant[variant];
    const a = report.after.perVariant[variant];
    console.log(`  ${label}: ${b.toFixed(1)} -> ${a.toFixed(1)}  (${a - b >= 0 ? "+" : ""}${(a - b).toFixed(1)})`);
  }
  console.log(`  overall: ${report.before.avg.toFixed(1)} -> ${report.after.avg.toFixed(1)}`);
  console.log(`gate decision: ${report.publish ? "PUBLISH" : "KEEP the current brain"}   (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
}

main();
