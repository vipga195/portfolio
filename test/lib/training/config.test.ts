import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readTrainerConfig } from "../../../src/lib/training/config.ts";
import { poolConfigFromEnv } from "../../../src/lib/training/connection.ts";

describe("readTrainerConfig", () => {
  it("uses defaults", () => {
    assert.deepEqual(readTrainerConfig({}), { maxRuntimeMs: 600_000, pollMs: 2000, staleMs: 60_000, workerMb: 512 });
    assert.equal(readTrainerConfig({ TRAINER_POLL_MS: "" }).pollMs, 2000);
  });

  it("accepts the boundaries", () => {
    const low = readTrainerConfig({ TRAINER_MAX_RUNTIME_MS: "1000", TRAINER_POLL_MS: "100", TRAINER_STALE_MS: "30000", TRAINER_WORKER_MB: "64" });
    assert.deepEqual(low, { maxRuntimeMs: 1000, pollMs: 100, staleMs: 30_000, workerMb: 64 });
    const high = readTrainerConfig({ TRAINER_MAX_RUNTIME_MS: "86400000", TRAINER_POLL_MS: "60000", TRAINER_STALE_MS: "86400000", TRAINER_WORKER_MB: "4096" });
    assert.deepEqual(high, { maxRuntimeMs: 86_400_000, pollMs: 60_000, staleMs: 86_400_000, workerMb: 4096 });
  });

  it("rejects values outside the boundaries and non-integers", () => {
    const bad: [string, string][] = [
      ["TRAINER_MAX_RUNTIME_MS", "999"], ["TRAINER_MAX_RUNTIME_MS", "86400001"], ["TRAINER_MAX_RUNTIME_MS", "3000000000"],
      ["TRAINER_POLL_MS", "99"], ["TRAINER_POLL_MS", "60001"], ["TRAINER_POLL_MS", "1.5"], ["TRAINER_POLL_MS", "-5"], ["TRAINER_POLL_MS", "abc"], ["TRAINER_POLL_MS", "NaN"],
      ["TRAINER_STALE_MS", "29999"], ["TRAINER_STALE_MS", "86400001"],
      ["TRAINER_WORKER_MB", "63"], ["TRAINER_WORKER_MB", "4097"], ["TRAINER_WORKER_MB", "1e3"],
    ];
    for (const [name, value] of bad) {
      assert.throws(() => readTrainerConfig({ [name]: value }), new RegExp(name), `${name}=${value}`);
    }
  });
});

describe("poolConfigFromEnv", () => {
  it("uses DATABASE_URL", () => {
    assert.deepEqual(poolConfigFromEnv({ DATABASE_URL: "postgres://u:p@h:1/d" }), { connectionString: "postgres://u:p@h:1/d" });
  });

  it("uses the PG* variables, with the default port", () => {
    assert.deepEqual(poolConfigFromEnv({ PGHOST: "db", PGUSER: "u", PGPASSWORD: "p@ss#w/rd?:x%", PGDATABASE: "d" }), {
      host: "db", port: 5432, user: "u", password: "p@ss#w/rd?:x%", database: "d",
    });
    assert.equal(poolConfigFromEnv({ PGHOST: "db", PGPORT: "6000" }).port, 6000);
  });

  it("DATABASE_URL wins over PG*", () => {
    assert.deepEqual(poolConfigFromEnv({ DATABASE_URL: "postgres://x", PGHOST: "db" }), { connectionString: "postgres://x" });
  });

  it("rejects a bad PGPORT", () => {
    assert.throws(() => poolConfigFromEnv({ PGHOST: "db", PGPORT: "abc" }), /PGPORT/);
  });

  it("throws a clear error naming both options, without secrets", () => {
    assert.throws(() => poolConfigFromEnv({ PGPASSWORD: "hunter2" }), (error: Error) => /DATABASE_URL/.test(error.message) && /PGHOST/.test(error.message) && !error.message.includes("hunter2"));
  });
});
