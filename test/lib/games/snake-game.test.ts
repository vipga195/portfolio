import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toDenseEnv, toEnv } from "../../../src/lib/ai/game.ts";
import { snakeDqnEnv } from "../../../src/lib/game/snake-dqn.ts";
import { snakeEnv } from "../../../src/lib/game/snake-env.ts";
import { snakeGame } from "../../../src/lib/game/snake-game.ts";
import { seededRng } from "../../../src/lib/rng.ts";

describe("snakeGame adapters", () => {
  it("toEnv(snakeGame) matches snakeEnv on seeded rollouts", () => {
    const env = toEnv(snakeGame);
    assert.equal(env.id, snakeEnv.id);
    assert.equal(env.stateCount, snakeEnv.stateCount);
    assert.equal(env.actionCount, snakeEnv.actionCount);
    assert.equal(env.featuresVersion, snakeEnv.featuresVersion);
    assert.deepEqual(env.evalVariants, snakeEnv.evalVariants);

    const a = seededRng(11);
    const b = seededRng(11);
    const actions = seededRng(5);
    for (let g = 0; g < 5; g++) {
      let sa = env.reset(a, 8);
      let sb = snakeEnv.reset(b, 8);
      assert.deepEqual(sa, sb);
      for (let i = 0; i < 300; i++) {
        assert.equal(env.encode(sa), snakeEnv.encode(sb));
        const action = Math.floor(actions() * env.actionCount);
        const ra = env.step(sa, action);
        const rb = snakeEnv.step(sb, action);
        assert.deepEqual(ra, rb);
        assert.equal(env.score(ra.next), snakeEnv.score(rb.next));
        sa = ra.next;
        sb = rb.next;
        if (ra.done) break;
      }
    }
  });

  it("toDenseEnv(snakeGame) matches snakeDqnEnv on seeded rollouts", () => {
    const env = toDenseEnv(snakeGame, snakeDqnEnv.id);
    assert.equal(env.id, snakeDqnEnv.id);
    assert.equal(env.observationSize, snakeDqnEnv.observationSize);
    assert.equal(env.actionCount, snakeDqnEnv.actionCount);
    assert.equal(env.featuresVersion, snakeDqnEnv.featuresVersion);

    const a = seededRng(21);
    const b = seededRng(21);
    const actions = seededRng(6);
    for (let g = 0; g < 5; g++) {
      let sa = env.reset(a);
      let sb = snakeDqnEnv.reset(b);
      assert.deepEqual(sa, sb);
      for (let i = 0; i < 300; i++) {
        assert.deepEqual(env.observe(sa), snakeDqnEnv.observe(sb));
        const action = Math.floor(actions() * env.actionCount);
        const ra = env.step(sa, action);
        const rb = snakeDqnEnv.step(sb, action);
        assert.deepEqual(ra, rb);
        sa = ra.next;
        sb = rb.next;
        if (ra.done) break;
      }
    }
  });
});
