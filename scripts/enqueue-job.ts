// Queues a training run (trusted CLI use: pass --trusted to exceed the public episode cap).
// Usage: DATABASE_URL=... (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) node scripts/enqueue-job.ts <game> <algorithm> <episodes> [--params '<json>'] [--trusted]
import { Pool } from "pg";
import type { PoolConfig } from "pg";

import { parseEpisodes } from "../src/lib/ai/algorithm.ts";
import { poolConfigFromEnv } from "../src/lib/training/connection.ts";
import { PgJobStore } from "../src/lib/training/jobs.ts";
import { ALGORITHMS, GAMES, getAlgorithm, getGame } from "../src/lib/registry.ts";

const USAGE = `Usage: node scripts/enqueue-job.ts <game> <algorithm> <episodes> [--params '<json>'] [--trusted]
  games: ${Object.keys(GAMES).join(", ")}   algorithms: ${Object.keys(ALGORITHMS).join(", ")}`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const trusted = args.includes("--trusted");
  const paramsAt = args.indexOf("--params");
  let rawParams = "{}";
  if (paramsAt !== -1) {
    rawParams = args[paramsAt + 1] ?? fail("--params needs a JSON value");
    args.splice(paramsAt, 2);
  }
  const [gameId, algorithmId, episodesArg] = args.filter((arg) => arg !== "--trusted");
  if (!gameId || !algorithmId || !episodesArg) fail(USAGE);

  let config: PoolConfig;
  try {
    config = poolConfigFromEnv();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "database not configured");
  }
  const game = getGame(gameId) ?? fail(`unknown game "${gameId}"\n${USAGE}`);
  const algorithm = getAlgorithm(algorithmId) ?? fail(`unknown algorithm "${algorithmId}"\n${USAGE}`);

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawParams);
  } catch {
    fail("--params is not valid JSON");
  }
  const params = algorithm.parseParams(rawJson) ?? fail("--params rejected: unknown key or value out of range");

  const episodes = Number(episodesArg);
  if (trusted) {
    if (!Number.isInteger(episodes) || episodes < 1 || episodes > 1_000_000) fail("episodes must be an integer in 1..1000000");
  } else if (parseEpisodes(algorithm, episodes) === null) {
    fail(`episodes must be an integer in 1..${algorithm.PUBLIC_MAX_EPISODES} for ${algorithm.id} (use --trusted to go higher)`);
  }

  const pool = new Pool({ ...config, max: 1 });
  try {
    const run = await new PgJobStore(pool).enqueue({ game: game.id, algorithm: algorithm.id, params, episodesTotal: episodes, trusted });
    console.log(`queued run ${run.id}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`enqueue failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
