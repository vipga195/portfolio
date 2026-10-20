// Benchmarks every registered algorithm's saved brain on one game with the shared deterministic benchmark.
// Usage: node scripts/compare.ts <game> [--games N] [--seed S]      e.g. node scripts/compare.ts snake
import { existsSync, readFileSync } from "node:fs";

import { BENCHMARK_GAMES, BENCHMARK_SEED, benchmarkPolicy } from "../src/lib/ai/benchmark.ts";
import type { BenchmarkResult } from "../src/lib/ai/benchmark.ts";
import { ALGORITHMS, GAMES, getGame } from "../src/lib/registry.ts";

function numberFlag(args: string[], flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  if (i === -1) return fallback;
  const value = Number(args[i + 1]);
  if (!Number.isInteger(value) || value < 0) {
    console.error(`${flag} needs a non-negative integer`);
    process.exit(1);
  }
  return value;
}

function main(): void {
  const args = process.argv.slice(2);
  const game = args[0] ? getGame(args[0]) : undefined;
  if (!game) {
    console.error(`Usage: node scripts/compare.ts <game> [--games N] [--seed S]   games: ${Object.keys(GAMES).join(", ")}`);
    process.exit(1);
  }
  const games = numberFlag(args, "--games", BENCHMARK_GAMES);
  const seed = numberFlag(args, "--seed", BENCHMARK_SEED);
  if (games < 1) {
    console.error("--games must be at least 1");
    process.exit(1);
  }

  const rows: { label: string; result: BenchmarkResult }[] = [];
  for (const algorithm of Object.values(ALGORITHMS)) {
    const file = `public/brains/${algorithm.brainGameId(game)}.json`;
    let json: unknown = null;
    if (existsSync(file)) {
      try {
        json = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        json = null;
      }
    }
    const model = json === null ? null : algorithm.parse(json, game);
    if (model === null) {
      console.log(`skip ${algorithm.id}: no valid brain at ${file}`);
      continue;
    }
    rows.push({ label: algorithm.id, result: benchmarkPolicy(game, (rng) => algorithm.createPolicy(model, game, rng), { games, seed }) });
  }
  if (rows.length === 0) return;

  console.log(`game=${game.id} games=${games} seed=${seed}   (avg / best)`);
  const columns = game.evalVariants.map((v) => v.label);
  const header = ["algorithm", ...columns, "overall"];
  const body = rows.map(({ label, result }) => [
    label,
    ...result.variants.map((v) => `${v.avg.toFixed(2)} / ${v.best}`),
    result.overall.toFixed(2),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  for (const row of body) console.log(line(row));
}

main();
