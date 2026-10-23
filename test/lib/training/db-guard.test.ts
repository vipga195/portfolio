import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkTestDatabaseUrl } from "./db-guard.ts";

describe("checkTestDatabaseUrl", () => {
  it("accepts a throwaway loopback database", () => {
    assert.equal(checkTestDatabaseUrl("postgres://postgres:pw@127.0.0.1:61806/postgres"), null);
    assert.equal(checkTestDatabaseUrl("postgres://postgres:pw@localhost:55432/scratch"), null);
    assert.equal(checkTestDatabaseUrl("postgres://postgres:pw@[::1]:55432/scratch"), null);
  });

  it("rejects port 5432 (also the default port) and the portfolio database", () => {
    assert.match(checkTestDatabaseUrl("postgres://u:p@127.0.0.1:5432/postgres") ?? "", /port/);
    assert.match(checkTestDatabaseUrl("postgres://u:p@127.0.0.1/postgres") ?? "", /port/);
    assert.match(checkTestDatabaseUrl("postgres://u:p@127.0.0.1:5433/portfolio") ?? "", /portfolio/);
  });

  it("rejects remote hosts, missing database and garbage; messages never echo the URL", () => {
    for (const bad of ["postgres://u:secret@db.example.com:5433/x", "postgres://u:secret@portfolio-db:5433/x", "postgres://u:secret@127.0.0.1:5433", "not a url"]) {
      const reason = checkTestDatabaseUrl(bad);
      assert.ok(reason, bad);
      assert.ok(!reason.includes("secret"));
    }
  });
});
