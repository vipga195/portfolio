import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_HP, MOVES, SUB } from '../../../src/lib/game/fighter/frame-data.ts';
import { BIT } from '../../../src/lib/game/fighter/inputs.ts';
import type { InputMask } from '../../../src/lib/game/fighter/inputs.ts';
import { hashFight, simulate } from '../../../src/lib/game/fighter/sim.ts';
import { screenToWorldMask } from '../../../src/lib/game/fighter/world/dirs.ts';
import { createWorldNpc, npcStepWorld } from '../../../src/lib/game/fighter/world/npc.ts';
import {
  INVULN_FRAMES,
  RESPAWN_FRAMES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  createWorld,
  createWorldSession,
  hashWorld,
  simulateWorld,
  stepWorld,
} from '../../../src/lib/game/fighter/world/sim.ts';
import type { WorldState } from '../../../src/lib/game/fighter/world/sim.ts';
import { seededRng } from '../../../src/lib/rng.ts';

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

// Fresh world with the player at (px, py) facing `dir` and the general at (gx, gy), positions in px.
function placed(px: number, py: number, dir: number, gx: number, gy: number): WorldState {
  const w = createWorld(1);
  return {
    ...w,
    player: { ...w.player, x: px * SUB, y: py * SUB, dir },
    general: { ...w.general, x: gx * SUB, y: gy * SUB },
  };
}

// Player starts `move`, the general stands still; returns the state after the whole move has played out.
function strike(start: WorldState, mask: InputMask, frames: number): WorldState {
  let s = stepWorld(start, [mask, 0]);
  for (let i = 1; i < frames; i++) s = stepWorld(s, [0, 0]);
  return s;
}

describe('world determinism', () => {
  test('same seed and inputs give the same hash, different inputs differ', () => {
    const a = randomStream(11, 400);
    const b = randomStream(12, 400);
    assert.equal(hashWorld(simulateWorld(5, a)), hashWorld(simulateWorld(5, a)));
    assert.notEqual(hashWorld(simulateWorld(5, a)), hashWorld(simulateWorld(5, b)));
  });

  test('stepWorld does not mutate its input', () => {
    const state = strike(placed(400, 400, 0, 450, 400), BIT.THRUST, 3);
    const snapshot = structuredClone(state);
    const next = stepWorld(state, [BIT.RIGHT, 0]);
    assert.deepEqual(state, snapshot);
    assert.notEqual(next.player, state.player);
  });

  test('golden hash for a fixed input script', () => {
    const script: InputMask[] = [];
    for (let i = 0; i < 600; i++) {
      script.push(i % 90 < 40 ? BIT.RIGHT | (i % 180 < 90 ? BIT.DOWN : BIT.UP) : i % 90 < 60 ? BIT.THRUST : i % 90 < 75 ? BIT.LEFT : BIT.CHOP);
    }
    assert.equal(hashWorld(simulateWorld(42, script)), 694741667);
  });
});

describe('fan hit', () => {
  const frames = MOVES.thrust.startup + MOVES.thrust.active + 1;

  test('target inside the arc is hit', () => {
    const s = strike(placed(400, 400, 0, 500, 410), BIT.THRUST, frames);
    assert.equal(s.general.hp, MAX_HP - MOVES.thrust.damage);
    assert.equal(s.general.state, 'hitstun');
  });

  test('target inside the arc is hit when facing south', () => {
    const s = strike(placed(400, 400, 4, 392, 500), BIT.THRUST, frames);
    assert.equal(s.general.hp, MAX_HP - MOVES.thrust.damage);
  });

  test('target outside the arc, behind, or out of range is missed', () => {
    assert.equal(strike(placed(400, 400, 0, 500, 500), BIT.THRUST, frames).general.hp, MAX_HP);
    assert.equal(strike(placed(400, 400, 0, 300, 400), BIT.THRUST, frames).general.hp, MAX_HP);
    assert.equal(strike(placed(400, 400, 0, 600, 400), BIT.THRUST, frames).general.hp, MAX_HP);
  });

  test('sweep has a wider arc than thrust', () => {
    const f = MOVES.sweep.startup + MOVES.sweep.active + 1;
    assert.equal(strike(placed(400, 400, 0, 450, 490), BIT.SWEEP, f).general.hp, MAX_HP - MOVES.sweep.damage);
    assert.equal(strike(placed(400, 400, 0, 450, 490), BIT.THRUST, frames).general.hp, MAX_HP);
  });
});

describe('death and respawn', () => {
  test('dead actor respawns in place with full hp and invulnerability', () => {
    const start = placed(400, 400, 0, 500, 400);
    let s = { ...start, general: { ...start.general, hp: 50 } };
    s = strike(s, BIT.THRUST, MOVES.thrust.startup + MOVES.thrust.active + 1);
    assert.equal(s.general.state, 'dead');
    assert.equal(s.general.hp, 0);
    const where = [s.general.x, s.general.y];

    let waited = 0;
    while (s.general.state === 'dead') {
      s = stepWorld(s, [0, 0]);
      waited += 1;
    }
    assert.ok(waited <= RESPAWN_FRAMES);
    assert.equal(s.general.state, 'idle');
    assert.equal(s.general.hp, MAX_HP);
    assert.equal(s.general.invuln, INVULN_FRAMES);
    assert.deepEqual([s.general.x, s.general.y], where);

    // An attack landing during invulnerability does nothing.
    s = strike(s, BIT.THRUST, MOVES.thrust.startup + MOVES.thrust.active + 1);
    assert.equal(s.general.hp, MAX_HP);
  });
});

describe('bounds and integers', () => {
  test('positions clamp to the world', () => {
    let s = createWorld(1);
    for (let i = 0; i < 3000; i++) s = stepWorld(s, [BIT.LEFT | BIT.UP, BIT.RIGHT | BIT.DOWN]);
    assert.ok(s.player.x >= 0 && s.player.y >= 0);
    assert.ok(s.general.x <= WORLD_WIDTH * SUB && s.general.y <= WORLD_HEIGHT * SUB);
    assert.equal(s.player.x, s.player.x | 0);
    const clamped = s.player.x < 100 * SUB && s.player.y < 100 * SUB && s.general.x > 1500 * SUB && s.general.y > 1100 * SUB;
    assert.ok(clamped);
  });

  test('state holds only integers after 600 random-input frames', () => {
    const inputs = randomStream(77, 600);
    let s = createWorld(9);
    let npc = createWorldNpc(123);
    for (const mask of inputs) {
      const [npcMask, next] = npcStepWorld(npc, s);
      npc = next;
      s = stepWorld(s, [mask, npcMask]);
      for (const a of [s.player, s.general]) {
        for (const v of [a.x, a.y, a.dir, a.hp, a.frame, a.stun, a.invuln]) assert.ok(Number.isInteger(v));
        assert.ok(a.dir >= 0 && a.dir < 16);
      }
      assert.ok(Number.isInteger(s.rng) && Number.isInteger(s.tick));
    }
  });
});

describe('body, knockback and held buttons', () => {
  test('holding an attack button starts one attack, not a chain', () => {
    let s = placed(400, 400, 0, 1200, 400);
    const total = MOVES.thrust.startup + MOVES.thrust.active + MOVES.thrust.recovery + 5;
    let starts = 0;
    for (let i = 0; i < total; i++) {
      const before = s.player.state;
      s = stepWorld(s, [BIT.THRUST, 0]);
      if (s.player.state === 'attack' && before !== 'attack') starts += 1;
    }
    assert.equal(starts, 1);
    assert.equal(s.player.state, 'idle');
  });

  test('releasing and pressing again starts a new attack', () => {
    let s = placed(400, 400, 0, 1200, 400);
    s = stepWorld(s, [BIT.THRUST, 0]);
    for (let i = 0; i < 60; i++) s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [BIT.THRUST, 0]);
    assert.equal(s.player.state, 'attack');
  });

  test('a landed hit shoves the target along the attacker facing', () => {
    const start = placed(400, 400, 0, 500, 410);
    const s = strike(start, BIT.THRUST, MOVES.thrust.startup + MOVES.thrust.active + 1);
    assert.ok(s.general.x > start.general.x);
  });

  test('two living bodies are pushed apart when they overlap', () => {
    const s = stepWorld(placed(400, 400, 0, 410, 400), [0, 0]);
    const dx = s.general.x - s.player.x;
    assert.ok(dx >= 2 * 18 * SUB - 2);
  });

  test('exactly stacked bodies separate deterministically along x', () => {
    const s = stepWorld(placed(400, 400, 0, 400, 400), [0, 0]);
    assert.ok(s.player.x < s.general.x);
    assert.equal(s.player.y, s.general.y);
  });

  test('a dead body does not block', () => {
    const w = placed(400, 400, 0, 410, 400);
    const s = stepWorld({ ...w, general: { ...w.general, state: 'dead', hp: 0 } }, [0, 0]);
    assert.equal(s.player.x, w.player.x);
  });
});

describe('screen-relative input', () => {
  test('maps screen directions onto the rotated iso world axes', () => {
    assert.equal(screenToWorldMask(BIT.UP), BIT.LEFT | BIT.UP);
    assert.equal(screenToWorldMask(BIT.DOWN), BIT.RIGHT | BIT.DOWN);
    assert.equal(screenToWorldMask(BIT.RIGHT), BIT.RIGHT | BIT.UP);
    assert.equal(screenToWorldMask(BIT.LEFT), BIT.LEFT | BIT.DOWN);
    assert.equal(screenToWorldMask(BIT.UP | BIT.RIGHT), BIT.UP);
    assert.equal(screenToWorldMask(BIT.DOWN | BIT.LEFT), BIT.DOWN);
    assert.equal(screenToWorldMask(BIT.UP | BIT.DOWN), 0);
  });

  test('keeps attack bits and ignores empty input', () => {
    assert.equal(screenToWorldMask(0), 0);
    assert.equal(screenToWorldMask(BIT.THRUST | BIT.UP), BIT.THRUST | BIT.LEFT | BIT.UP);
  });
});

describe('live session matches replay', () => {
  test('stepping a session by hand gives the same hash as simulateWorld', () => {
    const inputs = randomStream(11, 600);
    const session = createWorldSession(1);
    let world = session.world;
    let npc = session.npc;
    for (const mask of inputs) {
      const [npcMask, nextNpc] = npcStepWorld(npc, world);
      npc = nextNpc;
      world = stepWorld(world, [mask, npcMask]);
    }
    assert.equal(hashWorld(world), hashWorld(simulateWorld(1, inputs)));
  });
});

describe('duel lock', () => {
  test('golden hash for a fixed scripted fight', () => {
    const p1: InputMask[] = [];
    const p2: InputMask[] = [];
    for (let i = 0; i < 900; i++) {
      p1.push([BIT.RIGHT, BIT.THRUST, BIT.CHOP, BIT.DOWN | BIT.SWEEP, BIT.UP | BIT.RIGHT, 0][Math.floor(i / 15) % 6]);
      p2.push([BIT.LEFT, BIT.SWEEP, 0, BIT.THRUST, BIT.LEFT | BIT.DOWN, BIT.CHOP][Math.floor(i / 17) % 6]);
    }
    assert.equal(hashFight(simulate(7, p1, p2)), 3869626377);
  });
});
