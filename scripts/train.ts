// Trains a game's Q-table headlessly and writes it as a brain JSON file.
// Usage: node scripts/train.ts <game> [episodes] [outFile]      e.g. node scripts/train.ts snake 50000
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { brainEpisodes, parseBrain, toBrain } from "../src/lib/ai/brain.ts";
import type { Env } from "../src/lib/ai/env.ts";
import type { QTable } from "../src/lib/ai/qlearning.ts";
import { qLearningAlgorithm } from "../src/lib/ai/algorithms/q-learning.ts";
import { benchmarkPolicy } from "../src/lib/ai/benchmark.ts";
import { DEFAULT_TRAIN_OPTIONS, train } from "../src/lib/ai/train.ts";
import { snakeEnv } from "../src/lib/game/snake-env.ts";
import { getGame } from "../src/lib/registry.ts";

// Register a new game here after writing its Env adapter
const ENVS: Record<string, Env<unknown>> = {
  [snakeEnv.id]: snakeEnv,
};

// A resumed table already knows the basics, so start with little exploration instead of epsilon 1
const RESUME_EPSILON_START = 0.2;

function main(): void {
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const [gameId, episodesArg, outArg] = args.filter((arg) => arg !== "--resume");
  const env = gameId ? ENVS[gameId] : undefined;
  if (!env) {
    console.error(`Usage: node scripts/train.ts <game> [episodes] [outFile]   games: ${Object.keys(ENVS).join(", ")}`);
    process.exit(1);
  }

  const game = getGame(env.id);
  if (!game) {
    console.error(`game "${env.id}" is not registered in src/lib/registry.ts`);
    process.exit(1);
  }

  const episodes = Number(episodesArg ?? DEFAULT_TRAIN_OPTIONS.episodes);
  if (!Number.isInteger(episodes) || episodes < 1) {
    console.error("episodes must be a positive integer");
    process.exit(1);
  }
  const outFile = outArg ?? `public/brains/${env.id}.json`;
  const startedAt = Date.now();

  let initial: QTable | undefined;
  let trainedBefore = 0;
  if (resume) {
    // The brain file is untrusted input: parseBrain checks game id, features version and sizes
    let json: unknown = null;
    try {
      if (existsSync(outFile)) json = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      json = null;   // corrupt file: handled below like any invalid brain
    }
    const loaded = parseBrain(json, env);
    if (!loaded) {
      console.error(`--resume: no valid brain for "${env.id}" at ${outFile} (missing or trained with other features)`);
      process.exit(1);
    }
    initial = loaded;
    trainedBefore = brainEpisodes(json);
    console.log(`resuming from ${outFile} (${trainedBefore} episodes trained so far)`);
  }

  const table = train(
    env,
    {
      ...DEFAULT_TRAIN_OPTIONS,
      ...(resume ? { epsilonStart: RESUME_EPSILON_START } : {}),
      episodes,
      reportEvery: Math.max(1, Math.floor(episodes / 20)),
      onProgress: ({ episode, epsilon, avg, best }) => {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`episode ${episode}/${episodes}  eps=${epsilon.toFixed(2)}  avg=${avg.toFixed(2)}  best=${best}  ${seconds}s`);
      },
    },
    Math.random,
    initial,
  );

  console.log("greedy evaluation (no exploration):");
  // Shared deterministic benchmark: same seeds as scripts/compare.ts, so the numbers are comparable
  const result = benchmarkPolicy(game, (rng) => qLearningAlgorithm.createPolicy(table, game, rng));
  for (const { label, avg, best } of result.variants) {
    console.log(`  ${label}: avg=${avg.toFixed(2)} best=${best}`);
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(toBrain(env, table, trainedBefore + episodes)));
  console.log(`saved ${outFile}`);
}

main();
