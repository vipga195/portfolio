// Benchmarks every registered algorithm's saved brain on one game with the shared deterministic benchmark.
// Usage: node scripts/compare.ts <game> [--games N] [--seed S] [--json <file>]      e.g. node scripts/compare.ts snake
// --json writes the results as deterministic JSON (used for public/brains/snake.eval.json, the Training Lab baseline)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

// Metadata of a brain file for the JSON report; the file was already validated by algorithm.parse
function brainMeta(json: unknown): { featuresVersion: number | null; episodes: number | null } {
  const record = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};   // fields checked below
  const pick = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return { featuresVersion: pick(record.featuresVersion), episodes: pick(record.episodes) };
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

  const jsonAt = args.indexOf("--json");
  const jsonFile = jsonAt === -1 ? null : (args[jsonAt + 1] ?? null);
  // The value must exist and must not be another flag (otherwise "--json --games 5" would write a file named "--games")
  if (jsonAt !== -1 && (!jsonFile || jsonFile.startsWith("--"))) {
    console.error("--json needs a file path");
    process.exit(1);
  }

  const rows: { label: string; result: BenchmarkResult }[] = [];
  const brains: unknown[] = [];
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
    const result = benchmarkPolicy(game, (rng) => algorithm.createPolicy(model, game, rng), { games, seed });
    rows.push({ label: algorithm.id, result });
    brains.push({ algorithm: algorithm.id, brainGameId: algorithm.brainGameId(game), ...brainMeta(json), variants: result.variants, overall: result.overall });
  }
  if (jsonFile) {
    mkdirSync(dirname(jsonFile), { recursive: true });
    writeFileSync(jsonFile, `${JSON.stringify({ game: game.id, seed, games, brains }, null, 2)}\n`);
    console.log(`wrote ${jsonFile}`);
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
