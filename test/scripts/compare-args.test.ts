import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const SCRIPT = resolve("scripts/compare.ts");

function runIn(dir: string, args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, "snake", ...args], { cwd: dir, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

describe("scripts/compare.ts --json argument", () => {
  for (const args of [["--json"], ["--json", "--games", "5"]]) {
    it(`"${args.join(" ")}" exits 1 with a clear message and creates no file`, () => {
      const dir = mkdtempSync(join(tmpdir(), "compare-args-"));
      try {
        const { status, stderr } = runIn(dir, args);
        assert.equal(status, 1);
        assert.match(stderr, /--json needs a file path/);
        assert.deepEqual(readdirSync(dir), []);   // in particular no file named "--games"
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
