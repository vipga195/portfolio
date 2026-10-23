import { nextRandom } from '../../../rng.ts';
import { BODY_HALF_WIDTH, MAX_HP, SUB, WALK_SPEED } from '../frame-data.ts';
import { has } from '../inputs.ts';
import type { InputMask } from '../inputs.ts';
import { DIR_COS, DIR_COUNT, DIR_SIN, dirFromVector } from './dirs.ts';
import { PICKUP_FRAMES, PICKUP_RANGE_PX, WEAPON_DURABILITY, WEAPON_MOVES, WORLD_MOVES } from './moves.ts';
import type { WeaponKind, WorldMoveId } from './moves.ts';
import { createWorldNpc, npcStepWorld } from './npc.ts';
import type { WorldNpcState } from './npc.ts';
import { WBIT } from './winputs.ts';

export type ActorStateName = 'idle' | 'walk' | 'run' | 'crouch' | 'attack' | 'pickup' | 'hitstun' | 'dead';

export type Item = {
  kind: WeaponKind;
  x: number; // subpx
  y: number; // subpx
  durability: number;
};

export type Actor = {
  x: number; // subpx
  y: number; // subpx
  dir: number; // 0..15
  hp: number;
  state: ActorStateName;
  frame: number; // frames spent in the current attack, pickup, stun or dead state
  move: WorldMoveId | null;
  hitDone: boolean;
  stun: number; // total duration of the current hitstun
  invuln: number; // frames of invulnerability left
  atkHeld: boolean; // an attack button was down last frame, so holding it does not chain attacks
  pickHeld: boolean; // PICKUP was down last frame
  weapon: WeaponKind | null;
  durability: number; // hits left on the held weapon
  chain: number; // attacks in the current combo chain (0 when not attacking)
  heading: number; // 8-way heading held last frame, -1 = none
  lastTapDir: number; // heading of the last direction tap, -1 = none
  tapAge: number; // frames since the direction was last released, saturating at TAP_AGE_MAX
  dashArmed: number; // frames left in which ATK_B triggers a dash kick, 0 = not armed
};

export type WorldState = {
  tick: number;
  rng: number;
  player: Actor;
  general: Actor;
  items: Item[];
};

export const WORLD_WIDTH = 1600; // px
export const WORLD_HEIGHT = 1200; // px
export const RESPAWN_FRAMES = 120;
export const INVULN_FRAMES = 60;
export const RUN_SPEED = Math.trunc((WALK_SPEED * 17) / 10); // subpx/frame
export const DASH_SPEED = 2 * WALK_SPEED; // subpx/frame while a dash kick lunges
export const MAX_CHAIN = 3;
export const TAP_WINDOW = 15; // frames
const TAP_AGE_MAX = 255;

const MIN_X = BODY_HALF_WIDTH * SUB;
const MAX_X = (WORLD_WIDTH - BODY_HALF_WIDTH) * SUB;
const MIN_Y = BODY_HALF_WIDTH * SUB;
const MAX_Y = (WORLD_HEIGHT - BODY_HALF_WIDTH) * SUB;
const START_PLAYER = { x: 700 * SUB, y: 600 * SUB, dir: 0 };
const START_GENERAL = { x: 900 * SUB, y: 600 * SUB, dir: 8 };
const START_ITEMS: readonly { kind: WeaponKind; x: number; y: number }[] = [
  { kind: 'spear', x: 620 * SUB, y: 440 * SUB },
  { kind: 'staff', x: 980 * SUB, y: 760 * SUB },
];
const NPC_SEED_XOR = 0x9e3779b9;
const ATTACK_BITS = WBIT.ATK_A | WBIT.ATK_B | WBIT.ATK_C;
const BODY_DIAMETER = 2 * BODY_HALF_WIDTH * SUB;
const PICKUP_RANGE = PICKUP_RANGE_PX * SUB;

const STATE_INDEX: Record<ActorStateName, number> = { idle: 0, walk: 1, run: 2, crouch: 3, attack: 4, pickup: 5, hitstun: 6, dead: 7 };
const MOVE_INDEX: Record<WorldMoveId, number> = {
  punch: 0, kick: 1, heavy: 2, lowKick: 3, uppercut: 4, spin: 5, dash: 6,
  wThrust: 7, wSweep: 8, wChop: 9, sThrust: 10, sSweep: 11, sChop: 12,
};
const WEAPON_INDEX: Record<WeaponKind, number> = { spear: 0, staff: 1 };

function makeActor(start: { x: number; y: number; dir: number }): Actor {
  return {
    ...start,
    hp: MAX_HP,
    state: 'idle',
    frame: 0,
    move: null,
    hitDone: false,
    stun: 0,
    invuln: 0,
    atkHeld: false,
    pickHeld: false,
    weapon: null,
    durability: 0,
    chain: 0,
    heading: -1,
    lastTapDir: -1,
    tapAge: TAP_AGE_MAX,
    dashArmed: 0,
  };
}

export function createWorld(seed: number): WorldState {
  return {
    tick: 0,
    rng: seed >>> 0,
    player: makeActor(START_PLAYER),
    general: makeActor(START_GENERAL),
    items: START_ITEMS.map((i) => ({ ...i, durability: WEAPON_DURABILITY[i.kind] })),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function toIdle(a: Actor): void {
  a.state = 'idle';
  a.frame = 0;
  a.move = null;
  a.hitDone = false;
  a.stun = 0;
  a.chain = 0;
}

function advanceTimers(a: Actor): void {
  if (a.invuln > 0) a.invuln -= 1;
  if (a.dashArmed > 0) a.dashArmed -= 1;
  if (a.tapAge < TAP_AGE_MAX) a.tapAge += 1;
  switch (a.state) {
    case 'attack': {
      if (a.move === null) {
        toIdle(a);
        return;
      }
      const { startup, active, recovery } = WORLD_MOVES[a.move];
      a.frame += 1;
      if (a.frame >= startup + active + recovery) toIdle(a);
      return;
    }
    case 'pickup':
      a.frame += 1;
      if (a.frame >= PICKUP_FRAMES) toIdle(a);
      return;
    case 'hitstun':
      a.frame += 1;
      if (a.frame >= a.stun) toIdle(a);
      return;
    case 'dead':
      a.frame += 1;
      if (a.frame >= RESPAWN_FRAMES) {
        toIdle(a);
        a.hp = MAX_HP;
        a.invuln = INVULN_FRAMES;
      }
      return;
    default:
      return;
  }
}

function headingOf(mask: InputMask): number {
  const dx = (has(mask, WBIT.RIGHT) ? 1 : 0) - (has(mask, WBIT.LEFT) ? 1 : 0);
  const dy = (has(mask, WBIT.DOWN) ? 1 : 0) - (has(mask, WBIT.UP) ? 1 : 0);
  return dirFromVector(dx as -1 | 0 | 1, dy as -1 | 0 | 1);
}

// Double-tap rule (world-space heading, after screenToWorldMask): a "tap" is a heading press that starts from neutral
// (no direction held the frame before). Releasing to neutral zeroes tapAge. A tap of the same heading as lastTapDir
// with tapAge <= TAP_WINDOW (frames since the release) arms dashArmed for TAP_WINDOW frames; any other tap just
// becomes the new lastTapDir. Changing heading while a direction stays held is not a tap.
function trackTaps(a: Actor, heading: number): void {
  if (heading >= 0 && a.heading < 0) {
    if (heading === a.lastTapDir && a.tapAge <= TAP_WINDOW) {
      a.dashArmed = TAP_WINDOW;
      a.lastTapDir = -1;
    } else {
      a.lastTapDir = heading;
    }
  } else if (heading < 0 && a.heading >= 0) {
    a.tapAge = 0;
  }
  a.heading = heading;
}

// Move chosen by a fresh attack press, from the held weapon, crouch, combo bits and the dash window.
function chooseMove(a: Actor, mask: InputMask): WorldMoveId | null {
  const atkA = has(mask, WBIT.ATK_A);
  const atkB = has(mask, WBIT.ATK_B);
  const atkC = has(mask, WBIT.ATK_C);
  if (a.weapon !== null) {
    const set = WEAPON_MOVES[a.weapon];
    return atkA ? set[0] : atkB ? set[1] : atkC ? set[2] : null;
  }
  const crouching = has(mask, WBIT.CROUCH);
  if (atkB && atkC) return 'spin';
  if (atkB && a.dashArmed > 0) return 'dash';
  if (crouching && atkB) return 'lowKick';
  if (crouching && atkA) return 'uppercut';
  return atkA ? 'punch' : atkB ? 'kick' : atkC ? 'heavy' : null;
}

function startAttack(a: Actor, move: WorldMoveId, chain: number): void {
  a.state = 'attack';
  a.move = move;
  a.frame = 0;
  a.hitDone = false;
  a.chain = chain;
  if (move === 'dash') a.dashArmed = 0;
}

function nearestItemIndex(a: Actor, items: Item[]): number {
  let best = -1;
  let bestD2 = PICKUP_RANGE * PICKUP_RANGE;
  for (let i = 0; i < items.length; i++) {
    const dx = items[i].x - a.x;
    const dy = items[i].y - a.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2 && (best < 0 || d2 < bestD2)) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

// Fresh PICKUP press: drop the held weapon, or pick up the nearest item in range. Returns true when the actor is now busy.
function tryPickup(a: Actor, items: Item[]): boolean {
  if (a.weapon !== null) {
    items.push({ kind: a.weapon, x: a.x, y: a.y, durability: a.durability });
    a.weapon = null;
    a.durability = 0;
    return false;
  }
  const idx = nearestItemIndex(a, items);
  if (idx < 0) return false;
  const [item] = items.splice(idx, 1);
  a.weapon = item.kind;
  a.durability = item.durability;
  a.state = 'pickup';
  a.frame = 0;
  return true;
}

function walkBy(a: Actor, speed: number): void {
  a.x = clamp(a.x + Math.trunc((speed * DIR_COS[a.dir]) / 256), MIN_X, MAX_X);
  a.y = clamp(a.y + Math.trunc((speed * DIR_SIN[a.dir]) / 256), MIN_Y, MAX_Y);
}

// Step (a): turn the input into a facing change, movement, a pickup/drop or an attack start (or chain cancel).
function applyIntent(a: Actor, mask: InputMask, heading: number, freshAttack: boolean, freshPickup: boolean, items: Item[]): void {
  if (a.state === 'attack' && a.move !== null) {
    const data = WORLD_MOVES[a.move];
    const activeOver = a.frame >= data.startup + data.active;
    if (freshAttack && a.hitDone && activeOver && a.chain < MAX_CHAIN) {
      const next = chooseMove(a, mask);
      if (next !== null) {
        if (heading >= 0) a.dir = heading;
        startAttack(a, next, a.chain + 1);
        return;
      }
    }
    if (a.move === 'dash' && a.frame < data.startup + data.active) walkBy(a, DASH_SPEED);
    return;
  }
  if (a.state !== 'idle' && a.state !== 'walk' && a.state !== 'run' && a.state !== 'crouch') return;
  if (heading >= 0) a.dir = heading;

  if (freshPickup && tryPickup(a, items)) return;
  if (freshAttack) {
    const move = chooseMove(a, mask);
    if (move !== null) {
      startAttack(a, move, 1);
      return;
    }
  }
  if (has(mask, WBIT.CROUCH)) {
    a.state = 'crouch';
    return;
  }
  if (heading < 0) {
    a.state = 'idle';
    return;
  }
  const running = has(mask, WBIT.RUN);
  a.state = running ? 'run' : 'walk';
  walkBy(a, running ? RUN_SPEED : WALK_SPEED);
}

// Step (c): does the attacker's active move reach the defender? Fan = in range and within the arc of the facing.
function connects(att: Actor, def: Actor): boolean {
  if (att.state !== 'attack' || att.move === null || att.hitDone) return false;
  const data = WORLD_MOVES[att.move];
  if (att.frame < data.startup || att.frame >= data.startup + data.active) return false;
  if (def.state === 'dead' || def.invuln > 0) return false;
  if (def.state === 'crouch' && data.level === 'high') return false;

  const dx = def.x - att.x;
  const dy = def.y - att.y;
  const reach = (data.reachPx + BODY_HALF_WIDTH) * SUB;
  const d2 = dx * dx + dy * dy;
  if (d2 > reach * reach) return false;
  if (data.arcSteps >= DIR_COUNT / 2) return true;
  // dot is the target vector projected on the facing, scaled by 256; the arc test is dot >= |d| * cos(arc).
  const dot = dx * DIR_COS[att.dir] + dy * DIR_SIN[att.dir];
  if (dot <= 0) return false;
  const cosArc = DIR_COS[data.arcSteps];
  return dot * dot >= d2 * cosArc * cosArc;
}

// A landed weapon hit wears the weapon down; at 0 it breaks and is gone.
function spendWeapon(a: Actor): void {
  if (a.weapon === null || a.move === null || !WORLD_MOVES[a.move].armed) return;
  a.durability -= 1;
  if (a.durability <= 0) {
    a.weapon = null;
    a.durability = 0;
  }
}

function applyHit(att: Actor, def: Actor, items: Item[]): void {
  if (att.move === null) return;
  const data = WORLD_MOVES[att.move];
  let damage = data.damage;
  let push = data.knockbackPx;
  // Third link of an unarmed chain: +30% damage and +50% knockback.
  if (!data.armed && att.chain >= MAX_CHAIN) {
    damage = Math.trunc((damage * 13) / 10);
    push = Math.trunc((push * 3) / 2);
  }
  def.hp -= damage;
  def.x = clamp(def.x + Math.trunc((push * DIR_COS[att.dir] * SUB) / 256), MIN_X, MAX_X);
  def.y = clamp(def.y + Math.trunc((push * DIR_SIN[att.dir] * SUB) / 256), MIN_Y, MAX_Y);
  def.move = null;
  def.hitDone = false;
  def.frame = 0;
  def.chain = 0;
  if (def.hp <= 0) {
    def.hp = 0;
    def.state = 'dead';
    def.stun = 0;
    if (def.weapon !== null) {
      items.push({ kind: def.weapon, x: def.x, y: def.y, durability: def.durability });
      def.weapon = null;
      def.durability = 0;
    }
    return;
  }
  def.state = 'hitstun';
  def.stun = data.hitstun;
}

// Living bodies cannot overlap: push both apart along the line between them by half the overlap each.
function separate(a: Actor, b: Actor): void {
  if (a.state === 'dead' || b.state === 'dead') return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= BODY_DIAMETER * BODY_DIAMETER) return;
  if (d2 === 0) {
    // Exactly stacked: split along x so the result stays deterministic.
    const half = Math.trunc(BODY_DIAMETER / 2);
    a.x = clamp(a.x - half, MIN_X, MAX_X);
    b.x = clamp(b.x + half, MIN_X, MAX_X);
    return;
  }
  // sqrt of an integer below 2^53 is correctly rounded, so every engine agrees.
  const d = Math.max(1, Math.floor(Math.sqrt(d2)));
  const overlapHalf = Math.trunc((BODY_DIAMETER - d) / 2) + 1;
  const ox = Math.trunc((dx * overlapHalf) / d);
  const oy = Math.trunc((dy * overlapHalf) / d);
  a.x = clamp(a.x - ox, MIN_X, MAX_X);
  a.y = clamp(a.y - oy, MIN_Y, MAX_Y);
  b.x = clamp(b.x + ox, MIN_X, MAX_X);
  b.y = clamp(b.y + oy, MIN_Y, MAX_Y);
}

function act(a: Actor, mask: InputMask, items: Item[]): void {
  const heading = headingOf(mask);
  trackTaps(a, heading);
  const freshAttack = (mask & ATTACK_BITS) !== 0 && !a.atkHeld;
  const freshPickup = has(mask, WBIT.PICKUP) && !a.pickHeld;
  applyIntent(a, mask, heading, freshAttack, freshPickup, items);
  a.atkHeld = (mask & ATTACK_BITS) !== 0;
  a.pickHeld = has(mask, WBIT.PICKUP);
}

export function stepWorld(state: WorldState, inputs: [InputMask, InputMask]): WorldState {
  const player = { ...state.player };
  const general = { ...state.general };
  const items = state.items.map((i) => ({ ...i }));

  advanceTimers(player);
  advanceTimers(general);
  act(player, inputs[0], items);
  act(general, inputs[1], items);
  separate(player, general);

  // Hits are evaluated against the state at the start of the hit phase, so trades resolve together.
  const snapP = { ...player };
  const snapG = { ...general };
  const hitG = connects(snapP, snapG);
  const hitP = connects(snapG, snapP);
  if (hitG) spendWeapon(player);
  if (hitP) spendWeapon(general);
  if (hitG) applyHit(snapP, general, items);
  if (hitP) applyHit(snapG, player, items);
  if (hitG && player.state === 'attack') player.hitDone = true;
  if (hitP && general.state === 'attack') general.hitDone = true;

  return { tick: state.tick + 1, rng: nextRandom(state.rng)[1], player, general, items };
}

function mix(hash: number, value: number): number {
  let h = hash;
  const v = value | 0;
  for (let shift = 0; shift < 32; shift += 8) {
    h = Math.imul(h ^ ((v >>> shift) & 0xff), 16777619);
  }
  return h;
}

// 32-bit FNV-1a over every integer field of the state.
export function hashWorld(state: WorldState): number {
  let h = 0x811c9dc5;
  h = mix(h, state.tick);
  h = mix(h, state.rng);
  for (const a of [state.player, state.general]) {
    h = mix(h, a.x);
    h = mix(h, a.y);
    h = mix(h, a.dir % DIR_COUNT);
    h = mix(h, a.hp);
    h = mix(h, STATE_INDEX[a.state]);
    h = mix(h, a.frame);
    h = mix(h, a.move === null ? -1 : MOVE_INDEX[a.move]);
    h = mix(h, a.hitDone ? 1 : 0);
    h = mix(h, a.stun);
    h = mix(h, a.invuln);
    h = mix(h, a.atkHeld ? 1 : 0);
    h = mix(h, a.pickHeld ? 1 : 0);
    h = mix(h, a.weapon === null ? -1 : WEAPON_INDEX[a.weapon]);
    h = mix(h, a.durability);
    h = mix(h, a.chain);
    h = mix(h, a.heading);
    h = mix(h, a.lastTapDir);
    h = mix(h, a.tapAge);
    h = mix(h, a.dashArmed);
  }
  h = mix(h, state.items.length);
  for (const item of state.items) {
    h = mix(h, WEAPON_INDEX[item.kind]);
    h = mix(h, item.x);
    h = mix(h, item.y);
    h = mix(h, item.durability);
  }
  return h >>> 0;
}

// World plus its NPC, seeded the same way for the live game and for replays.
export function createWorldSession(seed: number): { world: WorldState; npc: WorldNpcState } {
  return { world: createWorld(seed), npc: createWorldNpc((seed ^ NPC_SEED_XOR) >>> 0) };
}

// Runs one frame per player input; the general is driven by the level-1 NPC.
export function simulateWorld(seed: number, playerInputs: InputMask[]): WorldState {
  const session = createWorldSession(seed);
  let state = session.world;
  let npc = session.npc;
  for (const mask of playerInputs) {
    const [npcMask, nextNpc] = npcStepWorld(npc, state);
    npc = nextNpc;
    state = stepWorld(state, [mask, npcMask]);
  }
  return state;
}
