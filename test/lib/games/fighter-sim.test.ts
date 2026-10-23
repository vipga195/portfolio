import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACK_SPEED,
  BODY_HALF_WIDTH,
  MAX_HP,
  MOVES,
  ROUND_FRAMES,
  STAGE_WIDTH,
  SUB,
  WALK_SPEED,
} from '../../../src/lib/game/fighter/frame-data.ts';
import { BACK, BIT, actionToMask, decodeInputs, encodeInputs } from '../../../src/lib/game/fighter/inputs.ts';
import type { InputMask } from '../../../src/lib/game/fighter/inputs.ts';
import { createFight, hashFight, simulate, stepFight } from '../../../src/lib/game/fighter/sim.ts';
import type { FightState } from '../../../src/lib/game/fighter/sim.ts';
import { seededRng } from '../../../src/lib/rng.ts';

// Fresh fight with both fighters moved to the given pixel positions.
function placed(p1Px: number, p2Px: number): FightState {
  const base = createFight(1);
  const [a, b] = base.fighters;
  return { ...base, fighters: [{ ...a, x: p1Px * SUB }, { ...b, x: p2Px * SUB }] };
}

// Steps `frames` ticks; scripted(tick) gives the inputs for that tick.
function run(
  start: FightState,
  frames: number,
  scripted: (tick: number) => [InputMask, InputMask],
): FightState {
  let state = start;
  for (let i = 0; i < frames; i++) state = stepFight(state, scripted(i));
  return state;
}

// Random input stream made of held masks, so real actions happen.
function randomStream(seed: number, length: number): InputMask[] {
  const rng = seededRng(seed);
  const out: InputMask[] = [];
  while (out.length < length) {
    const mask = Math.floor(rng() * 128);
    const hold = 1 + Math.floor(rng() * 12);
    for (let i = 0; i < hold && out.length < length; i++) out.push(mask);
  }
  return out;
}

describe('determinism', () => {
  test('same seed and inputs give the same hash', () => {
    const p1 = randomStream(11, 400);
    const p2 = randomStream(12, 400);
    assert.equal(hashFight(simulate(5, p1, p2)), hashFight(simulate(5, p1, p2)));
    assert.notEqual(hashFight(simulate(5, p1, p2)), hashFight(simulate(6, p1, p2)));
  });

  test('1000 random input streams replay identically', () => {
    for (let i = 0; i < 1000; i++) {
      const p1 = randomStream(i * 2 + 1, 300);
      const p2 = randomStream(i * 2 + 2, 300);
      assert.equal(hashFight(simulate(i, p1, p2)), hashFight(simulate(i, p1, p2)));
    }
  });

  test('stepFight does not mutate its input', () => {
    const start = placed(300, 380);
    const state = run(start, 5, () => [BIT.THRUST, 0]);
    const snapshot = structuredClone(state);
    const inputs: [InputMask, InputMask] = [BIT.CHOP | BIT.RIGHT, BIT.LEFT];
    const inputsCopy = [...inputs];
    const next = stepFight(state, inputs);
    assert.deepEqual(state, snapshot);
    assert.deepEqual(inputs, inputsCopy);
    assert.notEqual(next, state);
    assert.notEqual(next.fighters[0], state.fighters[0]);
  });
});

describe('input RLE', () => {
  test('round trip', () => {
    const frames = randomStream(7, 500);
    assert.deepEqual(decodeInputs(encodeInputs(frames)), frames);
    assert.deepEqual(decodeInputs(encodeInputs([])), []);
  });

  test('rejects bad data', () => {
    assert.equal(decodeInputs([1]), null);
    assert.equal(decodeInputs([200, 3]), null);
    assert.equal(decodeInputs([-1, 3]), null);
    assert.equal(decodeInputs([1, 0]), null);
    assert.equal(decodeInputs([1.5, 2]), null);
    assert.equal(decodeInputs([1, 2.5]), null);
  });
});

describe('combat', () => {
  test('thrust connects on an idle opponent in range', () => {
    const state = run(placed(300, 400), 30, (t) => [t === 0 ? BIT.THRUST : 0, 0]);
    assert.equal(state.fighters[1].hp, MAX_HP - MOVES.thrust.damage);
    assert.equal(state.fighters[0].hp, MAX_HP);
  });

  test('thrust out of range whiffs', () => {
    const state = run(placed(200, 600), 30, (t) => [t === 0 ? BIT.THRUST : 0, 0]);
    assert.equal(state.fighters[1].hp, MAX_HP);
  });

  test('holding BACK blocks, only chip damage', () => {
    const back = actionToMask(BACK, -1);
    const state = run(placed(300, 400), 30, (t) => [t === 0 ? BIT.THRUST : 0, back]);
    assert.equal(state.fighters[1].hp, MAX_HP - Math.floor(MOVES.thrust.damage / 10));
  });

  test('chop whiffs over a crouching defender', () => {
    const state = run(placed(300, 380), 50, (t) => [t === 0 ? BIT.CHOP : 0, BIT.DOWN]);
    assert.equal(state.fighters[1].hp, MAX_HP);
  });

  test('chop knocks down and the defender is invulnerable while down', () => {
    // Chop at tick 0 lasts 58 frames, then a thrust starts at tick 58 and is active at 67..69.
    const script = (t: number): [InputMask, InputMask] => [t === 0 ? BIT.CHOP : t === 58 ? BIT.THRUST : 0, 0];
    const afterChop = run(placed(300, 380), 26, script);
    assert.equal(afterChop.fighters[1].state, 'knockdown');
    assert.equal(afterChop.fighters[1].hp, MAX_HP - MOVES.chop.damage);

    const duringThrust = run(placed(300, 380), 72, script);
    assert.equal(duringThrust.fighters[1].state, 'knockdown');
    assert.equal(duringThrust.fighters[1].hp, MAX_HP - MOVES.chop.damage);

    const later = run(placed(300, 380), 140, script);
    assert.equal(later.fighters[1].state, 'idle');
  });
});

describe('movement', () => {
  test('walking moves x and BACK_SPEED is slower than WALK_SPEED', () => {
    assert.ok(BACK_SPEED < WALK_SPEED);
    const start = placed(300, 600);
    const forward = run(start, 10, () => [BIT.RIGHT, 0]);
    assert.equal(forward.fighters[0].x - start.fighters[0].x, 10 * WALK_SPEED);
    const backward = run(start, 10, () => [BIT.LEFT, 0]);
    assert.equal(start.fighters[0].x - backward.fighters[0].x, 10 * BACK_SPEED);
    assert.equal(forward.fighters[0].state, 'walk');
  });

  test('a jump leaves the ground and lands', () => {
    const start = placed(300, 600);
    let state = start;
    let maxY = 0;
    for (let t = 0; t < 120; t++) {
      state = stepFight(state, [t === 0 ? BIT.UP : 0, 0]);
      maxY = Math.max(maxY, state.fighters[0].y);
      if (t === 0) assert.equal(state.fighters[0].state, 'jump');
    }
    assert.ok(maxY > 0);
    assert.equal(state.fighters[0].y, 0);
    assert.equal(state.fighters[0].vy, 0);
    assert.equal(state.fighters[0].state, 'idle');
  });

  test('fighters never leave the stage or overlap', () => {
    const minX = BODY_HALF_WIDTH * SUB;
    const maxX = (STAGE_WIDTH - BODY_HALF_WIDTH) * SUB;
    for (let i = 0; i < 100; i++) {
      const p1 = randomStream(1000 + i * 2, 600);
      const p2 = randomStream(1001 + i * 2, 600);
      let state = createFight(i);
      for (let t = 0; t < 600 && state.winner === null; t++) {
        state = stepFight(state, [p1[t], p2[t]]);
        const [a, b] = state.fighters;
        for (const f of state.fighters) {
          assert.ok(f.x >= minX && f.x <= maxX, `x out of stage: ${f.x}`);
          assert.ok(f.y >= 0);
        }
        if (a.y === 0 && b.y === 0) {
          assert.ok(Math.abs(a.x - b.x) >= 2 * BODY_HALF_WIDTH * SUB, `overlap at stream ${i} tick ${t}`);
        }
      }
    }
  });
});

describe('round outcome', () => {
  test('timeout with equal hp is a draw', () => {
    const state = simulate(1, [], []);
    assert.equal(state.winner, 0);
    assert.equal(state.tick, ROUND_FRAMES);
  });

  test('timeout winner is the fighter with more hp', () => {
    let state = run(placed(300, 400), 30, (t) => [t === 0 ? BIT.THRUST : 0, 0]);
    while (state.winner === null) state = stepFight(state, [0, 0]);
    assert.equal(state.winner, 1);
    assert.equal(state.tick, ROUND_FRAMES);
  });

  test('winner is set when hp reaches 0 and the state then stops changing', () => {
    const base = placed(300, 400);
    const weak: FightState = { ...base, fighters: [base.fighters[0], { ...base.fighters[1], hp: 50 }] };
    const state = run(weak, 30, (t) => [t === 0 ? BIT.THRUST : 0, 0]);
    assert.equal(state.winner, 1);
    assert.equal(state.fighters[1].hp, 0);
    assert.equal(stepFight(state, [0, 0]), state);
  });

  test('both fighters knocked out on the same frame is a draw', () => {
    const base = placed(300, 380);
    const weak: FightState = {
      ...base,
      fighters: [{ ...base.fighters[0], hp: 10 }, { ...base.fighters[1], hp: 10 }],
    };
    const state = run(weak, 30, (t) => [t === 0 ? BIT.THRUST : 0, t === 0 ? BIT.THRUST : 0]);
    assert.equal(state.winner, 0);
  });
});
