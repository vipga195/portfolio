import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_HP, SUB, WALK_SPEED } from '../../../src/lib/game/fighter/frame-data.ts';
import { BIT } from '../../../src/lib/game/fighter/inputs.ts';
import type { InputMask } from '../../../src/lib/game/fighter/inputs.ts';
import { hashFight, simulate } from '../../../src/lib/game/fighter/sim.ts';
import { screenToWorldMask } from '../../../src/lib/game/fighter/world/dirs.ts';
import { WEAPON_DURABILITY, WORLD_MOVES } from '../../../src/lib/game/fighter/world/moves.ts';
import type { WorldMoveId } from '../../../src/lib/game/fighter/world/moves.ts';
import { createWorldNpc, npcStepWorld } from '../../../src/lib/game/fighter/world/npc.ts';
import {
  INVULN_FRAMES,
  RESPAWN_FRAMES,
  ROLL_COOLDOWN,
  ROLL_FRAMES,
  ROLL_SAFE_FRAMES,
  RUN_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  createWorld,
  createWorldSession,
  hashWorld,
  simulateWorld,
  stepWorld,
} from '../../../src/lib/game/fighter/world/sim.ts';
import type { Actor, Item, WorldState } from '../../../src/lib/game/fighter/world/sim.ts';
import { WBIT } from '../../../src/lib/game/fighter/world/winputs.ts';
import { seededRng } from '../../../src/lib/rng.ts';

const A = WBIT.ATK_A;
const B = WBIT.ATK_B;
const C = WBIT.ATK_C;

function randomStream(seed: number, length: number): InputMask[] {
  const rng = seededRng(seed);
  const out: InputMask[] = [];
  while (out.length < length) {
    const mask = Math.floor(rng() * 1024);
    const hold = 1 + Math.floor(rng() * 12);
    for (let i = 0; i < hold && out.length < length; i++) out.push(mask);
  }
  return out;
}

// Fresh world with the player at (px, py) facing `dir` and the general at (gx, gy), positions in px. No items.
function placed(px: number, py: number, dir: number, gx: number, gy: number): WorldState {
  const w = createWorld(1);
  return {
    ...w,
    items: [],
    player: { ...w.player, x: px * SUB, y: py * SUB, dir },
    general: { ...w.general, x: gx * SUB, y: gy * SUB },
  };
}

function item(kind: 'spear' | 'staff', x: number, y: number, durability = WEAPON_DURABILITY[kind]): Item {
  return { kind, x: x * SUB, y: y * SUB, durability };
}

function total(id: WorldMoveId): number {
  const m = WORLD_MOVES[id];
  return m.startup + m.active + m.recovery;
}

// Player starts a move, the general stands still; returns the state after `frames` frames.
function strike(start: WorldState, mask: InputMask, frames: number): WorldState {
  let s = stepWorld(start, [mask, 0]);
  for (let i = 1; i < frames; i++) s = stepWorld(s, [0, 0]);
  return s;
}

function hitFrames(id: WorldMoveId): number {
  return WORLD_MOVES[id].startup + WORLD_MOVES[id].active + 1;
}

function run(start: WorldState, mask: InputMask, frames: number): WorldState {
  let s = start;
  for (let i = 0; i < frames; i++) s = stepWorld(s, [mask, 0]);
  return s;
}

function armed(s: WorldState, kind: 'spear' | 'staff', durability = WEAPON_DURABILITY[kind]): WorldState {
  return { ...s, player: { ...s.player, weapon: kind, durability } };
}

describe('world determinism', () => {
  test('same seed and inputs give the same hash, different inputs differ', () => {
    const a = randomStream(11, 400);
    const b = randomStream(12, 400);
    assert.equal(hashWorld(simulateWorld(5, a)), hashWorld(simulateWorld(5, a)));
    assert.notEqual(hashWorld(simulateWorld(5, a)), hashWorld(simulateWorld(5, b)));
  });

  test('stepWorld does not mutate its input', () => {
    const state = strike(placed(400, 400, 0, 450, 400), A, 3);
    const snapshot = structuredClone(state);
    const next = stepWorld(state, [WBIT.RIGHT, 0]);
    assert.deepEqual(state, snapshot);
    assert.notEqual(next.player, state.player);
  });

  test('item list is part of the hash', () => {
    const w = createWorld(1);
    assert.notEqual(hashWorld(w), hashWorld({ ...w, items: [] }));
  });

  test('golden hash for a fixed input script', () => {
    const script: InputMask[] = [];
    for (let i = 0; i < 900; i++) {
      const phase = i % 120;
      if (phase < 40) script.push(WBIT.RIGHT | (i % 240 < 120 ? WBIT.DOWN : WBIT.UP) | (i % 3 === 0 ? WBIT.RUN : 0));
      else if (phase < 60) script.push(phase % 4 < 2 ? A : 0);
      else if (phase < 75) script.push(WBIT.LEFT | WBIT.PICKUP);
      else if (phase < 90) script.push(phase % 6 < 3 ? B | C : WBIT.CROUCH | A);
      else script.push(phase % 5 === 0 ? C : WBIT.UP);
    }
    assert.equal(hashWorld(simulateWorld(42, script)), 1491585796); // re-baselined when the projectile skills added two cooldown slots; end state pinned below
  });

  // Pins the observable end state of the same script, so a hash re-baseline cannot hide a behavior change.
  test('end state of the fixed input script is unchanged by the skill system', () => {
    const script: InputMask[] = [];
    for (let i = 0; i < 900; i++) {
      const phase = i % 120;
      if (phase < 40) script.push(WBIT.RIGHT | (i % 240 < 120 ? WBIT.DOWN : WBIT.UP) | (i % 3 === 0 ? WBIT.RUN : 0));
      else if (phase < 60) script.push(phase % 4 < 2 ? A : 0);
      else if (phase < 75) script.push(WBIT.LEFT | WBIT.PICKUP);
      else if (phase < 90) script.push(phase % 6 < 3 ? B | C : WBIT.CROUCH | A);
      else script.push(phase % 5 === 0 ? C : WBIT.UP);
    }
    const s = simulateWorld(42, script);
    const pick = (a: Actor): unknown => ({ x: a.x, y: a.y, hp: a.hp, state: a.state, dir: a.dir });
    assert.deepEqual(pick(s.player), { x: 250631, y: 150217, hp: 220, state: 'idle', dir: 14 });
    assert.deepEqual(pick(s.general), { x: 220481, y: 141659, hp: 770, state: 'walk', dir: 2 });
    assert.equal(s.items.length, 1);
  });
});

describe('unarmed fan hit', () => {
  test('punch hits inside its arc for 45 damage and shoves the target', () => {
    const start = placed(400, 400, 0, 450, 410);
    const s = strike(start, A, hitFrames('punch'));
    assert.equal(s.general.hp, MAX_HP - 45);
    assert.equal(s.general.state, 'hitstun');
    assert.equal(s.general.stun, 12);
    assert.ok(s.general.x > start.general.x);
  });

  test('punch reach is 48px plus the body, kick reaches further', () => {
    assert.equal(strike(placed(400, 400, 0, 460, 400), A, hitFrames('punch')).general.hp, MAX_HP - 45);
    assert.equal(strike(placed(400, 400, 0, 470, 400), A, hitFrames('punch')).general.hp, MAX_HP);
    assert.equal(strike(placed(400, 400, 0, 480, 400), B, hitFrames('kick')).general.hp, MAX_HP - 75);
    assert.equal(strike(placed(400, 400, 0, 490, 400), B, hitFrames('kick')).general.hp, MAX_HP);
  });

  test('heavy kick deals 120 and shoves harder than a punch', () => {
    const start = placed(400, 400, 0, 460, 400);
    const s = strike(start, C, hitFrames('heavy'));
    assert.equal(s.general.hp, MAX_HP - 120);
    const p = strike(start, A, hitFrames('punch'));
    assert.ok(s.general.x - start.general.x > p.general.x - start.general.x);
  });

  test('facing south works and out-of-arc, behind or out-of-range targets are missed', () => {
    assert.equal(strike(placed(400, 400, 4, 392, 450), A, hitFrames('punch')).general.hp, MAX_HP - 45);
    assert.equal(strike(placed(400, 400, 0, 440, 460), B, hitFrames('kick')).general.hp, MAX_HP);
    assert.equal(strike(placed(400, 400, 0, 350, 400), A, hitFrames('punch')).general.hp, MAX_HP);
    assert.equal(strike(placed(400, 400, 0, 600, 400), B, hitFrames('kick')).general.hp, MAX_HP);
  });

  test('punch arc is wider than kick arc', () => {
    // 60 degrees off axis at about 50px: inside punch (3 steps = 67.5), outside kick (2 steps = 45)
    assert.equal(strike(placed(400, 400, 0, 425, 443), A, hitFrames('punch')).general.hp, MAX_HP - 45);
    assert.equal(strike(placed(400, 400, 0, 425, 443), B, hitFrames('kick')).general.hp, MAX_HP);
  });
});

describe('weapon moves', () => {
  test('armed ATK_A/B/C use the spear thrust, sweep and chop', () => {
    const base = armed(placed(400, 400, 0, 1000, 400), 'spear');
    assert.equal(stepWorld(base, [A, 0]).player.move, 'wThrust');
    assert.equal(stepWorld(base, [B, 0]).player.move, 'wSweep');
    assert.equal(stepWorld(base, [C, 0]).player.move, 'wChop');
  });

  test('spear thrust keeps the old numbers (60 damage, 150px reach)', () => {
    const s = strike(armed(placed(400, 400, 0, 560, 400), 'spear'), A, hitFrames('wThrust'));
    assert.equal(s.general.hp, MAX_HP - 60);
    const far = strike(armed(placed(400, 400, 0, 580, 400), 'spear'), A, hitFrames('wThrust'));
    assert.equal(far.general.hp, MAX_HP);
  });

  test('staff reaches less far and hits 15% softer', () => {
    assert.equal(WORLD_MOVES.sThrust.damage, 51);
    const hit = strike(armed(placed(400, 400, 0, 520, 400), 'staff'), A, hitFrames('sThrust'));
    assert.equal(hit.general.hp, MAX_HP - 51);
    const miss = strike(armed(placed(400, 400, 0, 540, 400), 'staff'), A, hitFrames('sThrust'));
    assert.equal(miss.general.hp, MAX_HP);
  });

  test('crouch adds no skill while armed', () => {
    const base = armed(placed(400, 400, 0, 1000, 400), 'spear');
    assert.equal(stepWorld(base, [WBIT.CROUCH | A, 0]).player.move, 'wThrust');
  });
});

describe('pickups', () => {
  test('createWorld places a spear and a staff away from the actors', () => {
    const w = createWorld(1);
    assert.deepEqual(w.items.map((i) => i.kind), ['spear', 'staff']);
    assert.equal(w.player.weapon, null);
    assert.equal(w.general.weapon, null);
  });

  test('picks up an item within 40px, keeps durability, locks for 8 frames', () => {
    const w = { ...placed(400, 400, 0, 1000, 400), items: [item('spear', 430, 400, 5)] };
    let s = stepWorld(w, [WBIT.PICKUP, 0]);
    assert.equal(s.player.weapon, 'spear');
    assert.equal(s.player.durability, 5);
    assert.equal(s.items.length, 0);
    assert.equal(s.player.state, 'pickup');
    // Attacks are ignored while picking up
    s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [A, 0]);
    assert.equal(s.player.state, 'pickup');
    for (let i = 0; i < 10; i++) s = stepWorld(s, [0, 0]);
    assert.equal(s.player.state, 'idle');
  });

  test('cannot pick up an item farther than 40px', () => {
    const w = { ...placed(400, 400, 0, 1000, 400), items: [item('spear', 441, 400)] };
    const s = stepWorld(w, [WBIT.PICKUP, 0]);
    assert.equal(s.player.weapon, null);
    assert.equal(s.items.length, 1);
  });

  test('picks the nearest item, ties by lowest index', () => {
    const near = { ...placed(400, 400, 0, 1000, 400), items: [item('spear', 435, 400), item('staff', 410, 400)] };
    assert.equal(stepWorld(near, [WBIT.PICKUP, 0]).player.weapon, 'staff');
    const tie = { ...placed(400, 400, 0, 1000, 400), items: [item('spear', 420, 400), item('staff', 380, 400)] };
    assert.equal(stepWorld(tie, [WBIT.PICKUP, 0]).player.weapon, 'spear');
  });

  test('holding PICKUP picks up once, a fresh press drops the weapon where the actor stands', () => {
    const w = { ...placed(400, 400, 0, 1000, 400), items: [item('staff', 420, 400, 7)] };
    let s = run(w, WBIT.PICKUP, 20);
    assert.equal(s.player.weapon, 'staff');
    assert.equal(s.items.length, 0);
    s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [WBIT.PICKUP, 0]);
    assert.equal(s.player.weapon, null);
    assert.deepEqual(s.items, [{ kind: 'staff', x: 400 * SUB, y: 400 * SUB, durability: 7 }]);
  });

  test('a landed weapon hit costs one durability and the weapon breaks at 0', () => {
    const w = armed(placed(400, 400, 0, 460, 400), 'spear', 2);
    let s = strike(w, A, total('wThrust') + 2);
    assert.equal(s.player.durability, 1);
    assert.equal(s.player.weapon, 'spear');
    s = { ...s, general: { ...s.general, x: 460 * SUB, y: 400 * SUB, invuln: 0, state: 'idle', hp: MAX_HP } };
    s = strike(s, A, total('wThrust') + 2);
    assert.equal(s.player.weapon, null);
    assert.equal(s.player.durability, 0);
    assert.equal(s.items.length, 0);
  });

  test('an unarmed hit does not touch durability and a missed weapon swing is free', () => {
    const s = strike(armed(placed(400, 400, 0, 900, 400), 'spear', 3), A, total('wThrust') + 2);
    assert.equal(s.player.durability, 3);
  });

  test('a dying actor drops its weapon', () => {
    const start = placed(400, 400, 0, 450, 400);
    const w = { ...start, general: { ...start.general, hp: 10, weapon: 'staff' as const, durability: 9 } };
    const s = strike(w, A, hitFrames('punch'));
    assert.equal(s.general.state, 'dead');
    assert.equal(s.general.weapon, null);
    assert.equal(s.items.length, 1);
    assert.equal(s.items[0].kind, 'staff');
    assert.equal(s.items[0].durability, 9);
  });
});

describe('run and crouch', () => {
  test('run moves at 1.7x walk speed in state run', () => {
    const w = placed(400, 400, 0, 1200, 900);
    const walk = run(w, WBIT.RIGHT, 10);
    const sprint = run(w, WBIT.RIGHT | WBIT.RUN, 10);
    assert.equal(walk.player.state, 'walk');
    assert.equal(sprint.player.state, 'run');
    assert.equal(walk.player.x - w.player.x, 10 * WALK_SPEED);
    assert.equal(sprint.player.x - w.player.x, 10 * RUN_SPEED);
    assert.equal(RUN_SPEED, Math.trunc((WALK_SPEED * 17) / 10));
  });

  test('RUN without a direction stays idle', () => {
    assert.equal(stepWorld(placed(400, 400, 0, 1200, 900), [WBIT.RUN, 0]).player.state, 'idle');
  });

  test('crouch stops movement and releasing returns to idle', () => {
    const w = placed(400, 400, 0, 1200, 900);
    const s = run(w, WBIT.RIGHT | WBIT.CROUCH, 5);
    assert.equal(s.player.state, 'crouch');
    assert.equal(s.player.x, w.player.x);
    assert.equal(stepWorld(s, [0, 0]).player.state, 'idle');
  });

  test('crouching dodges high attacks but not mid ones', () => {
    const w = placed(400, 400, 0, 450, 400);
    let heavy = stepWorld(w, [C, WBIT.CROUCH]);
    for (let i = 1; i < hitFrames('heavy'); i++) heavy = stepWorld(heavy, [0, WBIT.CROUCH]);
    assert.equal(heavy.general.hp, MAX_HP);
    assert.equal(heavy.general.state, 'crouch');

    let kick = stepWorld(w, [B, WBIT.CROUCH]);
    for (let i = 1; i < hitFrames('kick'); i++) kick = stepWorld(kick, [0, WBIT.CROUCH]);
    assert.equal(kick.general.hp, MAX_HP - 75);

    const standing = strike(w, C, hitFrames('heavy'));
    assert.equal(standing.general.hp, MAX_HP - 120);
  });

  test('crouching also dodges the weapon chop', () => {
    const w = armed(placed(400, 400, 0, 480, 400), 'spear');
    let s = stepWorld(w, [C, WBIT.CROUCH]);
    for (let i = 1; i < hitFrames('wChop'); i++) s = stepWorld(s, [0, WBIT.CROUCH]);
    assert.equal(s.general.hp, MAX_HP);
  });
});

describe('combo skills', () => {
  test('crouch + J is an uppercut and crouch + K is a low kick', () => {
    const w = placed(400, 400, 0, 450, 400);
    assert.equal(stepWorld(w, [WBIT.CROUCH | A, 0]).player.move, 'uppercut');
    assert.equal(stepWorld(w, [WBIT.CROUCH | B, 0]).player.move, 'lowKick');
    assert.equal(strike(w, WBIT.CROUCH | A, hitFrames('uppercut')).general.hp, MAX_HP - 110);
    assert.equal(strike(w, WBIT.CROUCH | B, hitFrames('lowKick')).general.hp, MAX_HP - 70);
  });

  test('K + L the same frame is a full-circle spin kick', () => {
    const behind = placed(400, 400, 0, 350, 400);
    assert.equal(stepWorld(behind, [B | C, 0]).player.move, 'spin');
    assert.equal(strike(behind, B | C, hitFrames('spin')).general.hp, MAX_HP - 90);
    // Pressing one button a frame late is just a kick
    assert.equal(stepWorld(stepWorld(behind, [B, 0]), [B | C, 0]).player.move, 'kick');
  });

  test('double-tap a direction then K is a dash kick that lunges', () => {
    const w = placed(400, 400, 0, 1200, 900);
    let s = stepWorld(w, [WBIT.RIGHT, 0]);
    s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [WBIT.RIGHT, 0]);
    assert.ok(s.player.dashArmed > 0);
    const before = s.player.x;
    s = stepWorld(s, [B, 0]);
    assert.equal(s.player.move, 'dash');
    s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [0, 0]);
    assert.equal(s.player.x - before, 2 * 2 * WALK_SPEED);
  });

  test('dash kick damages a target in front', () => {
    const w = placed(400, 400, 0, 470, 400);
    let s = stepWorld(w, [WBIT.RIGHT, 0]);
    s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [WBIT.RIGHT, 0]);
    s = stepWorld(s, [B, 0]);
    for (let i = 0; i < 15; i++) s = stepWorld(s, [0, 0]);
    assert.equal(s.general.hp, MAX_HP - 100);
  });

  test('a slow second tap, a different heading or an expired window gives a plain kick', () => {
    const w = placed(400, 400, 0, 1200, 900);
    let slow = stepWorld(w, [WBIT.RIGHT, 0]);
    for (let i = 0; i < 20; i++) slow = stepWorld(slow, [0, 0]);
    slow = stepWorld(slow, [WBIT.RIGHT, 0]);
    assert.equal(slow.player.dashArmed, 0);
    assert.equal(stepWorld(slow, [B, 0]).player.move, 'kick');

    let other = stepWorld(w, [WBIT.RIGHT, 0]);
    other = stepWorld(other, [0, 0]);
    other = stepWorld(other, [WBIT.LEFT, 0]);
    assert.equal(other.player.dashArmed, 0);

    let late = stepWorld(w, [WBIT.RIGHT, 0]);
    late = stepWorld(late, [0, 0]);
    late = stepWorld(late, [WBIT.RIGHT, 0]);
    for (let i = 0; i < 16; i++) late = stepWorld(late, [WBIT.RIGHT, 0]);
    assert.equal(stepWorld(late, [B, 0]).player.move, 'kick');
  });

  test('holding a direction is not a double tap', () => {
    const s = run(placed(400, 400, 0, 1200, 900), WBIT.RIGHT, 30);
    assert.equal(s.player.dashArmed, 0);
  });
});

describe('combo chain', () => {
  // Presses the link buttons on alternate frames (so each press is fresh) until the third link has started.
  function chainRun(links: InputMask[], start: WorldState, frames: number): { s: WorldState; maxChain: number } {
    let s = start;
    let maxChain = 0;
    let stop = false;
    for (let i = 0; i < frames; i++) {
      if (s.player.chain >= 3) stop = true;
      const mask = !stop && i % 2 === 0 ? links[Math.min(s.player.chain, links.length - 1)] : 0;
      s = stepWorld(s, [mask, 0]);
      maxChain = Math.max(maxChain, s.player.chain);
    }
    return { s, maxChain };
  }

  test('a fresh press after a connecting hit cancels recovery into the next attack, from its startup', () => {
    let s = placed(400, 400, 0, 436, 400);
    s = stepWorld(s, [A, 0]);
    let cancelled = false;
    for (let i = 0; i < 20 && !cancelled; i++) {
      const wasHit = s.player.hitDone && s.player.frame + 1 >= WORLD_MOVES.punch.startup + WORLD_MOVES.punch.active;
      const next = stepWorld(s, [wasHit ? A : 0, 0]);
      if (next.player.chain === 2) {
        cancelled = true;
        assert.equal(next.player.move, 'punch');
        assert.equal(next.player.frame, 0);
        assert.equal(next.general.hp, s.general.hp);
        assert.ok(next.player.frame < WORLD_MOVES.punch.startup);
      }
      s = next;
    }
    assert.ok(cancelled);
  });

  test('without a connecting hit there is no cancel', () => {
    let s = placed(400, 400, 0, 1200, 900);
    for (let i = 0; i < total('punch') - 1; i++) {
      s = stepWorld(s, [i % 2 === 0 ? A : 0, 0]);
      assert.equal(s.player.chain, 1);
    }
  });

  test('A, A, B: third link deals +30% damage and more knockback, chain is capped at 3', () => {
    const start = placed(400, 400, 0, 436, 400);
    const { s, maxChain } = chainRun([A, A, B], start, 100);
    assert.equal(maxChain, 3);
    const third = Math.trunc((WORLD_MOVES.kick.damage * 13) / 10);
    assert.equal(s.general.hp, MAX_HP - 45 - 45 - third);
    assert.equal(third, 97);
  });

  test('the bonus applies to the third link whatever it is, and not to a lone punch', () => {
    const { s } = chainRun([A, A, A], placed(400, 400, 0, 436, 400), 100);
    assert.equal(s.general.hp, MAX_HP - 45 - 45 - Math.trunc((45 * 13) / 10));
    assert.equal(strike(placed(400, 400, 0, 450, 400), A, hitFrames('punch')).general.hp, MAX_HP - 45);
  });

  test('chain resets after returning to idle', () => {
    const { s } = chainRun([A, A, B], placed(400, 400, 0, 436, 400), 100);
    const later = run({ ...s, general: { ...s.general, x: 1200 * SUB } }, 0, 80);
    assert.equal(later.player.chain, 0);
    assert.equal(later.player.state, 'idle');
  });
});

describe('death and respawn', () => {
  test('dead actor respawns in place with full hp and invulnerability', () => {
    const start = placed(400, 400, 0, 450, 400);
    let s = { ...start, general: { ...start.general, hp: 40 } };
    s = strike(s, A, hitFrames('punch'));
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
    s = strike(s, A, hitFrames('punch') + total('punch'));
    assert.equal(s.general.hp, MAX_HP);
  });
});

describe('bounds and integers', () => {
  test('positions clamp to the world', () => {
    let s = createWorld(1);
    for (let i = 0; i < 3000; i++) s = stepWorld(s, [WBIT.LEFT | WBIT.UP | WBIT.RUN, WBIT.RIGHT | WBIT.DOWN]);
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
        for (const v of [a.x, a.y, a.dir, a.hp, a.frame, a.stun, a.invuln, a.durability, a.chain, a.heading, a.lastTapDir, a.tapAge, a.dashArmed]) {
          assert.ok(Number.isInteger(v));
        }
        assert.ok(a.dir >= 0 && a.dir < 16);
        assert.ok(a.chain >= 0 && a.chain <= 3);
      }
      for (const it of s.items) assert.ok(Number.isInteger(it.x) && Number.isInteger(it.y) && Number.isInteger(it.durability));
      assert.ok(Number.isInteger(s.rng) && Number.isInteger(s.tick));
    }
  });
});

describe('body, knockback and held buttons', () => {
  test('holding an attack button starts one attack, not a chain', () => {
    let s = placed(400, 400, 0, 1200, 400);
    const frames = total('punch') + 5;
    let starts = 0;
    for (let i = 0; i < frames; i++) {
      const before = s.player.state;
      s = stepWorld(s, [A, 0]);
      if (s.player.state === 'attack' && before !== 'attack') starts += 1;
    }
    assert.equal(starts, 1);
    assert.equal(s.player.state, 'idle');
  });

  test('releasing and pressing again starts a new attack', () => {
    let s = placed(400, 400, 0, 1200, 400);
    s = stepWorld(s, [A, 0]);
    for (let i = 0; i < 60; i++) s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [A, 0]);
    assert.equal(s.player.state, 'attack');
  });

  test('hitstun interrupts an attack in progress', () => {
    const w = placed(400, 400, 0, 450, 400);
    let s = stepWorld(w, [0, B]);
    for (let i = 0; i < 3; i++) s = stepWorld(s, [0, 0]);
    s = stepWorld(s, [A, 0]);
    for (let i = 0; i < 6; i++) s = stepWorld(s, [0, 0]);
    assert.equal(s.general.hp, MAX_HP - 45);
    assert.equal(s.general.state === 'hitstun' || s.general.state === 'idle', true);
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
    assert.equal(screenToWorldMask(WBIT.UP), WBIT.LEFT | WBIT.UP);
    assert.equal(screenToWorldMask(WBIT.DOWN), WBIT.RIGHT | WBIT.DOWN);
    assert.equal(screenToWorldMask(WBIT.RIGHT), WBIT.RIGHT | WBIT.UP);
    assert.equal(screenToWorldMask(WBIT.LEFT), WBIT.LEFT | WBIT.DOWN);
    assert.equal(screenToWorldMask(WBIT.UP | WBIT.RIGHT), WBIT.UP);
    assert.equal(screenToWorldMask(WBIT.DOWN | WBIT.LEFT), WBIT.DOWN);
    assert.equal(screenToWorldMask(WBIT.UP | WBIT.DOWN), 0);
  });

  test('keeps attack, run, crouch and pickup bits and ignores empty input', () => {
    assert.equal(screenToWorldMask(0), 0);
    assert.equal(screenToWorldMask(A | WBIT.UP), A | WBIT.LEFT | WBIT.UP);
    const extras = WBIT.RUN | WBIT.CROUCH | WBIT.PICKUP | B | C;
    assert.equal(screenToWorldMask(extras | WBIT.DOWN), extras | WBIT.RIGHT | WBIT.DOWN);
  });

  test('world bits keep the Duel values for direction and the three attacks', () => {
    assert.equal(WBIT.LEFT, BIT.LEFT);
    assert.equal(WBIT.RIGHT, BIT.RIGHT);
    assert.equal(WBIT.UP, BIT.UP);
    assert.equal(WBIT.DOWN, BIT.DOWN);
    assert.equal(A, BIT.THRUST);
    assert.equal(B, BIT.SWEEP);
    assert.equal(C, BIT.CHOP);
  });
});

describe('npc', () => {
  test('unarmed npc in kick range attacks with a hand or foot move, never a weapon move', () => {
    const w = placed(400, 400, 0, 460, 400);
    const seen = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const [mask] = npcStepWorld(createWorldNpc(seed), w);
      seen.add(mask & (A | B | C));
    }
    assert.ok(seen.has(B));
    for (const m of seen) assert.ok([0, A, B, C].includes(m));
  });

  test('npc walks to a nearby weapon and picks it up', () => {
    const w = { ...placed(100, 100, 0, 900, 600), items: [item('spear', 960, 600)] };
    let s = w;
    let got = false;
    for (let seed = 1; seed < 40 && !got; seed++) {
      s = w;
      let npc = createWorldNpc(seed);
      for (let i = 0; i < 400 && !got; i++) {
        const [mask, next] = npcStepWorld(npc, s);
        npc = next;
        s = stepWorld(s, [0, mask]);
        if (s.general.weapon === 'spear') got = true;
      }
    }
    assert.ok(got);
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

describe('command skills', () => {
  const L = WBIT.LEFT;
  const R = WBIT.RIGHT;
  const CR = WBIT.CROUCH;

  function skilled(px: number, py: number, dir: number, gx: number, gy: number): WorldState {
    const w = placed(px, py, dir, gx, gy);
    return { ...w, player: { ...w.player, skills: true } };
  }

  // Feeds the player masks one per frame while the general stands still.
  function feed(start: WorldState, masks: InputMask[]): WorldState {
    let s = start;
    for (const m of masks) s = stepWorld(s, [m, 0]);
    return s;
  }

  const BLINK_CMD = [L, L, R | C];
  const BURST_CMD = [CR, 0, CR | C];

  test('back, toward + C casts a blink strike and spends stamina and cooldown', () => {
    const s = feed(skilled(300, 600, 0, 1500, 100), BLINK_CMD);
    assert.equal(s.player.state, 'attack');
    assert.equal(s.player.move, 'blink');
    assert.equal(s.player.stamina, 600);
    assert.equal(s.player.cd[0], 240);
  });

  test('crouch, crouch + C casts a burst', () => {
    const s = feed(skilled(300, 600, 0, 1500, 100), BURST_CMD);
    assert.equal(s.player.move, 'burst');
    assert.equal(s.player.stamina, 1000 - 450);
    assert.equal(s.player.cd[1], 300);
  });

  test('a command older than the window falls back to the plain move', () => {
    const s = feed(skilled(300, 600, 0, 1500, 100), [L, ...new Array<InputMask>(25).fill(0), R | C]);
    assert.equal(s.player.move, 'heavy');
    assert.equal(s.player.stamina, 1000);
  });

  test('an actor with skills off ignores the command', () => {
    const s = feed(placed(300, 600, 0, 1500, 100), BLINK_CMD);
    assert.equal(s.player.move, 'heavy');
  });

  test('not enough stamina falls back to the plain move', () => {
    const w = skilled(300, 600, 0, 1500, 100);
    const s = feed({ ...w, player: { ...w.player, stamina: 100 } }, BLINK_CMD);
    assert.equal(s.player.move, 'heavy');
  });

  test('a skill on cooldown falls back to the plain move, then works again after it', () => {
    let s = feed(skilled(300, 600, 0, 1500, 100), BLINK_CMD);
    s = run(s, 0, total('blink'));
    assert.equal(s.player.state, 'idle');
    assert.ok(s.player.cd[0] > 0);
    s = feed(s, BLINK_CMD);
    assert.equal(s.player.move, 'heavy');
    s = run(s, 0, 260);
    assert.equal(s.player.cd[0], 0);
    s = feed(s, BLINK_CMD);
    assert.equal(s.player.move, 'blink');
  });

  test('stamina regenerates every frame up to the cap', () => {
    let s = feed(skilled(300, 600, 0, 1500, 100), BLINK_CMD);
    const before = s.player.stamina;
    s = run(s, 0, 10);
    assert.equal(s.player.stamina, before + 30);
    s = run(s, 0, 400);
    assert.equal(s.player.stamina, 1000);
  });

  test('blink lunges forward during its startup and active frames', () => {
    let s = feed(skilled(300, 600, 0, 1500, 100), BLINK_CMD);
    const x0 = s.player.x;
    s = run(s, 0, total('blink'));
    const { startup, active } = WORLD_MOVES.blink;
    assert.equal(s.player.x - x0, (startup + active - 1) * 5 * WALK_SPEED);
  });

  test('blink hits a target in front for 160 damage', () => {
    const s = feed(skilled(300, 600, 0, 360, 600), BLINK_CMD);
    const end = run(s, 0, total('blink'));
    assert.equal(end.general.hp, MAX_HP - WORLD_MOVES.blink.damage);
  });

  test('burst hits a target behind the caster and pushes it away from the caster', () => {
    const start = skilled(700, 600, 0, 650, 600);
    const gx = start.general.x;
    const s = feed(start, BURST_CMD);
    const end = run(s, 0, total('burst'));
    assert.equal(end.general.hp, MAX_HP - WORLD_MOVES.burst.damage);
    assert.ok(end.general.x < gx);
  });

  test('burst misses a target outside its radius', () => {
    const s = feed(skilled(300, 600, 0, 700, 600), BURST_CMD);
    const end = run(s, 0, total('burst'));
    assert.equal(end.general.hp, MAX_HP);
  });

  test('existing moves keep precedence: B+C spin, crouch+A uppercut', () => {
    assert.equal(feed(skilled(300, 600, 0, 1500, 100), [L, R | B | C]).player.move, 'spin');
    assert.equal(feed(skilled(300, 600, 0, 1500, 100), [CR, 0, CR | A]).player.move, 'uppercut');
  });

  test('a double-tap and B is still a dash kick', () => {
    const s = feed(skilled(300, 600, 0, 1500, 100), [R, 0, R, R | B]);
    assert.equal(s.player.move, 'dash');
  });

  test('chain links never cast a skill', () => {
    let s = feed(skilled(300, 600, 0, 340, 600), [A]);
    s = run(s, 0, WORLD_MOVES.punch.startup + WORLD_MOVES.punch.active);
    assert.equal(s.player.hitDone, true);
    s = feed(s, [L, R | C]);
    assert.equal(s.player.move, 'heavy');
    assert.equal(s.player.chain, 2);
    assert.equal(s.player.stamina, 1000);
  });

  test('skill state is part of the hash and a step never mutates its input', () => {
    const w = skilled(300, 600, 0, 1500, 100);
    const snapshot = JSON.stringify(w);
    const next = stepWorld(w, [CR, 0]);
    assert.equal(JSON.stringify(w), snapshot);
    assert.notEqual(hashWorld(next), hashWorld({ ...next, player: { ...next.player, cmdTok: [-1, -1, -1] } }));
    assert.notEqual(hashWorld(w), hashWorld({ ...w, player: { ...w.player, stamina: w.player.stamina - 1 } }));
  });
});

describe('projectile skills', () => {
  const R = WBIT.RIGHT;
  const CR = WBIT.CROUCH;
  const FIREBALL_CMD = [CR, 0, R | A];
  const WAVE_CMD = [CR, 0, R | B];

  function skilled(gx: number): WorldState {
    const w = placed(300, 600, 0, gx, 600);
    return { ...w, player: { ...w.player, skills: true } };
  }

  function feed(start: WorldState, masks: InputMask[]): WorldState {
    let s = start;
    for (const m of masks) s = stepWorld(s, [m, 0]);
    return s;
  }

  test('crouch, toward + J casts a fireball and K casts a slash wave', () => {
    const f = feed(skilled(1500), FIREBALL_CMD);
    assert.equal(f.player.move, 'fireball');
    assert.equal(f.player.stamina, 1000 - 250);
    assert.equal(f.player.cd[2], 45);
    const w = feed(skilled(1500), WAVE_CMD);
    assert.equal(w.player.move, 'wave');
    assert.equal(w.player.stamina, 1000 - 300);
    assert.equal(w.player.cd[3], 90);
  });

  test('the projectile spawns on the first active frame and flies forward', () => {
    let s = feed(skilled(1500), FIREBALL_CMD);
    assert.equal(s.projectiles.length, 0);
    s = run(s, 0, WORLD_MOVES.fireball.startup);
    assert.equal(s.projectiles.length, 1);
    const p = s.projectiles[0];
    assert.equal(p.owner, 0);
    assert.equal(p.move, 'fireball');
    const x0 = p.x;
    s = run(s, 0, 5);
    assert.equal(s.projectiles[0].x - x0, 5 * 6 * SUB);
  });

  test('the cast itself deals no melee damage', () => {
    const s = feed(skilled(330), FIREBALL_CMD);
    const early = run(s, 0, WORLD_MOVES.fireball.startup - 1);
    assert.equal(early.general.hp, MAX_HP);
  });

  test('a fireball hits once and is consumed', () => {
    let s = feed(skilled(600), FIREBALL_CMD);
    s = run(s, 0, 80);
    assert.equal(s.general.hp, MAX_HP - WORLD_MOVES.fireball.damage);
    assert.equal(s.projectiles.length, 0);
  });

  test('a slash wave passes through the target after hitting it once', () => {
    let s = feed(skilled(600), WAVE_CMD);
    s = run(s, 0, 100);
    assert.equal(s.general.hp, MAX_HP - WORLD_MOVES.wave.damage);
    assert.equal(s.projectiles.length, 0);
  });

  test('a projectile expires after its lifetime and never hits an out-of-range target', () => {
    let s = feed(skilled(1500), FIREBALL_CMD);
    s = run(s, 0, 100);
    assert.equal(s.general.hp, MAX_HP);
    assert.equal(s.projectiles.length, 0);
  });

  test('a rolling target is untouchable inside the roll safe window', () => {
    let s = feed(skilled(600), FIREBALL_CMD);
    s = { ...s, general: { ...s.general, state: 'roll', frame: 0 } };
    s = run(s, 0, 4);
    assert.equal(s.general.hp, MAX_HP);
  });

  test('projectiles are part of the hash and a step never mutates its input', () => {
    const s = run(feed(skilled(1500), FIREBALL_CMD), 0, WORLD_MOVES.fireball.startup);
    const snapshot = JSON.stringify(s);
    stepWorld(s, [0, 0]);
    assert.equal(JSON.stringify(s), snapshot);
    assert.notEqual(hashWorld(s), hashWorld({ ...s, projectiles: [] }));
  });
});

describe('roll and weapon toss', () => {
  const ROLL = WBIT.CROUCH | WBIT.RUN | WBIT.RIGHT;

  test('crouch + run + a direction starts a roll that moves the actor', () => {
    const w = placed(700, 600, 0, 1200, 600);
    const s = stepWorld(w, [ROLL, 0]);
    assert.equal(s.player.state, 'roll');
    assert.ok(stepWorld(s, [ROLL, 0]).player.x > s.player.x);
  });

  test('a roll is untouchable at the start but not at the end, then needs a cooldown', () => {
    const base = placed(700, 600, 0, 740, 600);
    const striker = { ...base.general, dir: 8, state: 'attack' as const, move: 'punch' as const, frame: WORLD_MOVES.punch.startup - 1 };
    const early = stepWorld({ ...base, player: { ...base.player, state: 'roll', frame: 3 }, general: striker }, [0, 0]);
    assert.equal(early.player.hp, MAX_HP);
    const late = stepWorld({ ...base, player: { ...base.player, state: 'roll', frame: ROLL_SAFE_FRAMES }, general: striker }, [0, 0]);
    assert.ok(late.player.hp < MAX_HP);

    let s = stepWorld(placed(700, 600, 0, 1200, 600), [ROLL, 0]);
    for (let i = 0; i < ROLL_FRAMES; i++) s = stepWorld(s, [0, 0]);
    assert.equal(s.player.state, 'idle');
    assert.equal(s.player.rollCd, ROLL_COOLDOWN);
    assert.notEqual(stepWorld(s, [ROLL, 0]).player.state, 'roll');
  });

  test('A + B while armed tosses the weapon: it hits at range and lands on the ground', () => {
    const w = placed(600, 600, 0, 780, 600);
    const armed = { ...w, player: { ...w.player, weapon: 'spear' as const, durability: 14 } };
    assert.equal(stepWorld(armed, [A | B, 0]).player.move, 'wToss');
    const s = strike(armed, A | B, hitFrames('wToss'));
    assert.equal(s.player.weapon, null);
    assert.equal(s.items.length, 1);
    assert.equal(s.items[0].durability, 13);
    assert.equal(s.general.hp, MAX_HP - 90);
  });
});
