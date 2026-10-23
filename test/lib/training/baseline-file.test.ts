import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { BENCHMARK_GAMES, BENCHMARK_SEED } from "../../../src/lib/ai/benchmark.ts";
import { snakeGame } from "../../../src/lib/game/snake-game.ts";
import { parseBaseline } from "../../../src/lib/training/lab-client.ts";

describe("public/brains/snake.eval.json", () => {
  const baseline: unknown = JSON.parse(readFileSync("public/brains/snake.eval.json", "utf8"));
  const brain: unknown = JSON.parse(readFileSync("public/brains/snake.json", "utf8"));
  const record = baseline as Record<string, unknown>;   // checked by the assertions below

  it("parses and uses the shared benchmark seed", () => {
    assert.equal(record.game, "snake");
    assert.equal(record.seed, BENCHMARK_SEED);
    assert.equal(record.games, BENCHMARK_GAMES);
    const brains = parseBaseline(baseline);
    assert.ok(brains && brains.length >= 1);
    assert.equal(brains[0].algorithm, "q-learning");
    assert.equal(brains[0].evaluation.variants.length, snakeGame.evalVariants.length);
  });

  it("is not stale: same featuresVersion as the shipped brain and the current encoding", () => {
    const brains = parseBaseline(baseline);
    const shippedVersion = (brain as Record<string, unknown>).featuresVersion;   // brain file is an object
    assert.equal(brains?.[0].featuresVersion, shippedVersion);
    assert.equal(shippedVersion, snakeGame.tabular?.featuresVersion);
    assert.equal(brains?.[0].episodes, (brain as Record<string, unknown>).episodes);
  });
});
