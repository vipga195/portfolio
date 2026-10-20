// Trains a game's Q-table headlessly and writes it as a brain JSON file.
// Usage: node scripts/train.ts <game> [episodes] [outFile]      e.g. node scripts/train.ts snake 50000
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { toBrain } from "../src/lib/ai/brain.ts";
import type { Env } from "../src/lib/ai/env.ts";
import { DEFAULT_TRAIN_OPTIONS, evaluate, train } from "../src/lib/ai/train.ts";
import { snakeEnv } from "../src/lib/game/snake-env.ts";

// Register a new game here after writing its Env adapter
const ENVS: Record<string, Env<unknown>> = {
  [snakeEnv.id]: snakeEnv,
};

const EVAL_GAMES = 100;

function main(): void {
  const [gameId, episodesArg, outArg] = process.argv.slice(2);
  const env = gameId ? ENVS[gameId] : undefined;
  if (!env) {
    console.error(`Usage: node scripts/train.ts <game> [episodes] [outFile]   games: ${Object.keys(ENVS).join(", ")}`);
    process.exit(1);
  }

  const episodes = Number(episodesArg ?? DEFAULT_TRAIN_OPTIONS.episodes);
  if (!Number.isInteger(episodes) || episodes < 1) {
    console.error("episodes must be a positive integer");
    process.exit(1);
  }
  const outFile = outArg ?? `public/brains/${env.id}.json`;
  const startedAt = Date.now();

  const table = train(env, {
    ...DEFAULT_TRAIN_OPTIONS,
    episodes,
    reportEvery: Math.max(1, Math.floor(episodes / 20)),
    onProgress: ({ episode, epsilon, avg, best }) => {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`episode ${episode}/${episodes}  eps=${epsilon.toFixed(2)}  avg=${avg.toFixed(2)}  best=${best}  ${seconds}s`);
    },
  });

  console.log("greedy evaluation (no exploration):");
  for (const { label, variant } of env.evalVariants) {
    const { avg, best } = evaluate(env, table, variant, EVAL_GAMES);
    console.log(`  ${label}: avg=${avg.toFixed(2)} best=${best}`);
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(toBrain(env, table, episodes)));
  console.log(`saved ${outFile}`);
}

main();
