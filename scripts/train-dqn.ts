// Trains a DQN agent for Snake headlessly and writes it as a brain JSON file.
// Usage: node scripts/train-dqn.ts [episodes] [outFile] [--resume]      e.g. node scripts/train-dqn.ts 20000
// --resume continues from the weights already saved in outFile instead of starting from scratch
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { brainEpisodes, parseBrain } from "../src/lib/ai/brain.ts";
import { qLearningAlgorithm } from "../src/lib/ai/algorithms/q-learning.ts";
import { dqnAlgorithm } from "../src/lib/ai/algorithms/dqn.ts";
import { benchmarkPolicy } from "../src/lib/ai/benchmark.ts";
import { DEFAULT_DQN_OPTIONS, parseDqnBrain, toDqnBrain, trainDqn } from "../src/lib/ai/dqn.ts";
import type { DenseEnv } from "../src/lib/ai/dqn.ts";
import type { Mlp } from "../src/lib/ai/nn.ts";
import { snakeDqnEnv } from "../src/lib/game/snake-dqn.ts";
import { snakeGame } from "../src/lib/game/snake-game.ts";
import { snakeEnv } from "../src/lib/game/snake-env.ts";
import type { SnakeEnvState } from "../src/lib/game/snake-env.ts";
import { MIN_GRID_SIZE } from "../src/lib/game/snake.ts";

const Q_BRAIN_FILE = "public/brains/snake.json";
// Training episodes use smaller grids (faster, the network only sees a local window anyway); evaluation covers all variants
const TRAIN_MAX_GRID = 20;
// A resumed network already knows the basics, so start with little exploration instead of epsilon 1
const RESUME_EPSILON_START = 0.2;

const trainEnv: DenseEnv<SnakeEnvState> = {
  ...snakeDqnEnv,
  reset: (rng, variant) => snakeDqnEnv.reset(rng, variant ?? MIN_GRID_SIZE + Math.floor(rng() * (TRAIN_MAX_GRID - MIN_GRID_SIZE + 1))),
};

function loadQTable(): ReturnType<typeof parseBrain> {
  try {
    return parseBrain(JSON.parse(readFileSync(Q_BRAIN_FILE, "utf8")), snakeEnv);
  } catch {
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const [episodesArg, outArg] = args.filter((arg) => arg !== "--resume");
  const episodes = Number(episodesArg ?? DEFAULT_DQN_OPTIONS.episodes);
  if (!Number.isInteger(episodes) || episodes < 1) {
    console.error("Usage: node scripts/train-dqn.ts [episodes] [outFile]   (episodes must be a positive integer)");
    process.exit(1);
  }
  const outFile = outArg ?? `public/brains/${snakeDqnEnv.id}.json`;
  const startedAt = Date.now();

  let initial: Mlp | undefined;
  let trainedBefore = 0;
  if (resume) {
    // The brain file is untrusted input: parseDqnBrain checks game id, features version and sizes
    let json: unknown = null;
    try {
      if (existsSync(outFile)) json = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      json = null;   // corrupt file: handled below like any invalid brain
    }
    const loaded = parseDqnBrain(json, snakeDqnEnv);
    if (!loaded) {
      console.error(`--resume: no valid brain for "${snakeDqnEnv.id}" at ${outFile} (missing or trained with other features)`);
      process.exit(1);
    }
    initial = loaded;
    trainedBefore = brainEpisodes(json);
    console.log(`resuming from ${outFile} (${trainedBefore} episodes trained so far)`);
  }

  const net = trainDqn(
    trainEnv,
    {
      ...DEFAULT_DQN_OPTIONS,
      ...(resume ? { epsilonStart: RESUME_EPSILON_START } : {}),
      episodes,
      reportEvery: Math.max(1, Math.floor(episodes / 20)),
      onProgress: ({ episode, epsilon, avg, best, loss }) => {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`episode ${episode}/${episodes}  eps=${epsilon.toFixed(2)}  avg=${avg.toFixed(2)}  best=${best}  loss=${loss.toFixed(4)}  ${seconds}s`);
      },
    },
    Math.random,
    initial,
  );

  const table = loadQTable();
  if (!table) console.log(`(no valid Q-table brain at ${Q_BRAIN_FILE}, skipping comparison)`);
  // Shared deterministic benchmark: both agents play the same games (same seeds), and the numbers match scripts/compare.ts
  const dqnResult = benchmarkPolicy(snakeGame, (rng) => dqnAlgorithm.createPolicy(net, snakeGame, rng));
  const qResult = table ? benchmarkPolicy(snakeGame, (rng) => qLearningAlgorithm.createPolicy(table, snakeGame, rng)) : null;
  console.log(`greedy evaluation (no exploration, ${dqnResult.variants[0].games} games each):`);
  dqnResult.variants.forEach((dqn, i) => {
    const q = qResult?.variants[i];
    const qText = q ? `   q-table: avg=${q.avg.toFixed(2)} best=${q.best}` : "";
    console.log(`  ${dqn.label}: dqn: avg=${dqn.avg.toFixed(2)} best=${dqn.best}${qText}`);
  });

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(toDqnBrain(snakeDqnEnv, net, trainedBefore + episodes)));
  console.log(`saved ${outFile}`);
}

main();
