import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { brainEpisodes } from "../../../src/lib/ai/brain.ts";

describe("brainEpisodes", () => {
  it("reads the episode count of a saved brain", () => {
    assert.equal(brainEpisodes({ game: "snake", episodes: 20000 }), 20000);
  });

  it("returns 0 for anything that is not a valid count", () => {
    for (const bad of [null, undefined, "x", 5, {}, { episodes: "10" }, { episodes: -1 }, { episodes: 1.5 }, { episodes: NaN }]) {
      assert.equal(brainEpisodes(bad), 0);
    }
  });
});
