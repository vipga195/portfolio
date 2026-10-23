import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROUND_FRAMES } from '../../../src/lib/game/fighter/frame-data.ts';
import { createNpc, npcStep } from '../../../src/lib/game/fighter/npc.ts';
import type { NpcLevel, NpcState } from '../../../src/lib/game/fighter/npc.ts';
import { BIT, has } from '../../../src/lib/game/fighter/inputs.ts';
import type { InputMask } from '../../../src/lib/game/fighter/inputs.ts';
import { createFight, stepFight } from '../../../src/lib/game/fighter/sim.ts';
import type { FightState } from '../../../src/lib/game/fighter/sim.ts';

const LEVELS: NpcLevel[] = [1, 2, 3];

// Runs a round where the NPC controls `side` and the other side plays a fixed mask; returns the masks and final state.
function runVsIdle(level: NpcLevel, seed: number, side: 0 | 1): { masks: InputMask[]; fight: FightState } {
  let fight = createFight(seed);
  let npc = createNpc(level, seed + 1);
  const masks: InputMask[] = [];
  while (fight.winner === null) {
    const [mask, next] = npcStep(npc, fight, side);
    npc = next;
    masks.push(mask);
    fight = stepFight(fight, side === 0 ? [mask, 0] : [0, mask]);
  }
  return { masks, fight };
}

test('same inputs give the same NPC masks over 600 frames', () => {
  const run = (): InputMask[] => {
    let fight = createFight(7);
    let npc = createNpc(3, 99);
    const masks: InputMask[] = [];
    for (let i = 0; i < 600; i++) {
      const [mask, next] = npcStep(npc, fight, 1);
      npc = next;
      masks.push(mask);
      fight = stepFight(fight, [i % 40 < 10 ? 2 : i % 40 < 14 ? 16 : 0, mask]);
    }
    return masks;
  };
  assert.deepEqual(run(), run());
});

test('masks are always valid (0..127) and no level crashes over 50 seeds', () => {
  for (const level of LEVELS) {
    for (let seed = 1; seed <= 50; seed++) {
      for (const side of [0, 1] as const) {
        const { masks } = runVsIdle(level, seed, side);
        for (const m of masks) assert.ok(Number.isInteger(m) && m >= 0 && m <= 127);
      }
    }
  }
});

test('a level 3 NPC beats an idle opponent within one round', () => {
  for (const side of [0, 1] as const) {
    const { fight } = runVsIdle(3, 5, side);
    assert.ok(fight.tick <= ROUND_FRAMES);
    assert.equal(fight.winner, side === 0 ? 1 : 2);
  }
});

test('level 3 beats level 1 in a majority of 20 seeded rounds', () => {
  let wins = 0;
  for (let i = 0; i < 20; i++) {
    const hardSide: 0 | 1 = i % 2 === 0 ? 0 : 1;
    const easySide: 0 | 1 = hardSide === 0 ? 1 : 0;
    let fight = createFight(1000 + i);
    let hard: NpcState = createNpc(3, 17 + i);
    let easy: NpcState = createNpc(1, 311 + i);
    while (fight.winner === null) {
      const [hm, hn] = npcStep(hard, fight, hardSide);
      const [em, en] = npcStep(easy, fight, easySide);
      hard = hn;
      easy = en;
      const inputs: [InputMask, InputMask] = hardSide === 0 ? [hm, em] : [em, hm];
      fight = stepFight(fight, inputs);
    }
    const hardHp = fight.fighters[hardSide].hp;
    const easyHp = fight.fighters[easySide].hp;
    if (hardHp > easyHp) wins++;
  }
  assert.ok(wins > 10, `level 3 won only ${wins}/20`);
});

test('level 3 blocks (holds away) against a close thrust in its active window', () => {
  const base = createFight(1);
  const attacker = { ...base.fighters[1], x: base.fighters[0].x + 60 * 256, state: 'attack' as const, move: 'thrust' as const, frame: 8, facing: -1 as const };
  const fight: FightState = { ...base, fighters: [base.fighters[0], attacker] };

  let blockMask: InputMask | null = null;
  for (let seed = 1; seed < 1000 && blockMask === null; seed++) {
    const [mask] = npcStep(createNpc(3, seed), fight, 0);
    if (has(mask, BIT.LEFT) && !has(mask, BIT.RIGHT) && mask === BIT.LEFT) blockMask = mask;
  }
  assert.equal(blockMask, BIT.LEFT);

  // The held direction really blocks in the sim: the NPC fighter ends up in blockstun, not hitstun.
  const after = stepFight(fight, [BIT.LEFT, 0]);
  assert.equal(after.fighters[0].state, 'blockstun');
});
