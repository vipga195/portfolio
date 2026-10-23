import { nextRandom } from '../../../rng.ts';
import { BODY_HALF_WIDTH, MAX_HP, SUB, WALK_SPEED } from '../frame-data.ts';
import { has } from '../inputs.ts';
import type { InputMask } from '../inputs.ts';
import { DIR_COS, DIR_COUNT, DIR_SIN, dirFromVector } from './dirs.ts';
import { PICKUP_FRAMES, PICKUP_RANGE_PX, PROJECTILE_DEFS, WEAPON_DURABILITY, WEAPON_MOVES, WEAPON_TOSS_REACH_PX, WORLD_MOVES, isProjectileMove } from './moves.ts';
import type { ProjectileMove, WeaponKind, WorldMoveId } from './moves.ts';
import { createWorldNpc, npcStepWorld } from './npc.ts';
import type { WorldNpcState } from './npc.ts';
import { CMD_LEN, MAX_STAMINA, SKILL_COUNT, SKILL_DEFS, STAMINA_REGEN, TOK_CROUCH, matchSkill } from './skills.ts';
import { WBIT } from './winputs.ts';

export type ActorStateName = 'idle' | 'walk' | 'run' | 'crouch' | 'attack' | 'pickup' | 'hitstun' | 'dead' | 'roll';

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
  rollCd: number; // frames until another roll is allowed
  skills: boolean; // command skills enabled (off for NPC and training actors)
  stamina: number; // spent by skills, regenerates every frame
  cd: number[]; // frames left on each SKILL_DEFS cooldown
  cmdTok: number[]; // last CMD_LEN command tokens (headings or TOK_CROUCH), -1 = empty, oldest first
  cmdAge: number[]; // frames since each token was logged, saturating at TAP_AGE_MAX
  crouchHeld: boolean; // CROUCH was down last frame
};

export type Projectile = {
  owner: 0 | 1; // 0 = player, 1 = general
  move: ProjectileMove;
  x: number; // subpx
  y: number; // subpx
  dir: number; // 0..15
  age: number; // frames since it was spawned
  hitDone: boolean; // a piercing projectile has already hit its target
};

export type WorldState = {
  tick: number;
  rng: number;
  player: Actor;
  general: Actor;
  items: Item[];
  projectiles: Projectile[];
};

export const WORLD_WIDTH = 1600; // px
export const WORLD_HEIGHT = 1200; // px
export const RESPAWN_FRAMES = 120;
export const INVULN_FRAMES = 60;
export const RUN_SPEED = Math.trunc((WALK_SPEED * 17) / 10); // subpx/frame
export const DASH_SPEED = 2 * WALK_SPEED; // subpx/frame while a dash kick lunges
export const BLINK_SPEED = 5 * WALK_SPEED; // subpx/frame while a blink strike lunges
export const MAX_CHAIN = 3;
export const ROLL_FRAMES = 18;
export const ROLL_SAFE_FRAMES = 12; // untouchable window at the start of a roll
export const ROLL_COOLDOWN = 30;
export const ROLL_SPEED = Math.trunc((RUN_SPEED * 4) / 3);
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
const PROJECTILE_SPAWN_PX = 24; // distance in front of the caster where a projectile appears

const STATE_INDEX: Record<ActorStateName, number> = { idle: 0, walk: 1, run: 2, crouch: 3, attack: 4, pickup: 5, hitstun: 6, dead: 7, roll: 8 };
const MOVE_INDEX: Record<WorldMoveId, number> = {
  punch: 0, kick: 1, heavy: 2, lowKick: 3, uppercut: 4, spin: 5, dash: 6,
  wThrust: 7, wSweep: 8, wChop: 9, sThrust: 10, sSweep: 11, sChop: 12,
  blink: 13, burst: 14, wToss: 15, fireball: 16, wave: 17,
};
const WEAPON_INDEX: Record<WeaponKind, number> = { spear: 0, staff: 1 };

function makeActor(start: { x: number; y: number; dir: number }, skills: boolean): Actor {
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
    rollCd: 0,
    skills,
    stamina: MAX_STAMINA,
    cd: new Array<number>(SKILL_COUNT).fill(0),
    cmdTok: new Array<number>(CMD_LEN).fill(-1),
    cmdAge: new Array<number>(CMD_LEN).fill(TAP_AGE_MAX),
    crouchHeld: false,
  };
}

// Copies an actor including its arrays, so a step never mutates the previous state.
function cloneActor(a: Actor): Actor {
  return { ...a, cd: [...a.cd], cmdTok: [...a.cmdTok], cmdAge: [...a.cmdAge] };
}

// Command skills are off by default: training and NPC actors must keep their exact old behavior.
export function createWorld(seed: number, options: { playerSkills?: boolean } = {}): WorldState {
  return {
    tick: 0,
    rng: seed >>> 0,
    player: makeActor(START_PLAYER, options.playerSkills === true),
    general: makeActor(START_GENERAL, false),
    items: START_ITEMS.map((i) => ({ ...i, durability: WEAPON_DURABILITY[i.kind] })),
    projectiles: [],
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
  if (a.rollCd > 0) a.rollCd -= 1;
  if (a.tapAge < TAP_AGE_MAX) a.tapAge += 1;
  if (a.state !== 'dead' && a.stamina < MAX_STAMINA) a.stamina = Math.min(MAX_STAMINA, a.stamina + STAMINA_REGEN);
  for (let i = 0; i < SKILL_COUNT; i++) if (a.cd[i] > 0) a.cd[i] -= 1;
  for (let i = 0; i < CMD_LEN; i++) if (a.cmdAge[i] < TAP_AGE_MAX) a.cmdAge[i] += 1;
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
    case 'roll':
      a.frame += 1;
      if (a.frame >= ROLL_FRAMES) {
        toIdle(a);
        a.rollCd = ROLL_COOLDOWN;
      }
      return;
    case 'dead':
      a.frame += 1;
      if (a.frame >= RESPAWN_FRAMES) {
        toIdle(a);
        a.hp = MAX_HP;
        a.stamina = MAX_STAMINA;
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

// Shifts a command token into the buffer (oldest drops off).
function pushToken(a: Actor, token: number): void {
  for (let i = 0; i < CMD_LEN - 1; i++) {
    a.cmdTok[i] = a.cmdTok[i + 1];
    a.cmdAge[i] = a.cmdAge[i + 1];
  }
  a.cmdTok[CMD_LEN - 1] = token;
  a.cmdAge[CMD_LEN - 1] = 0;
}

// Logs a heading change and a fresh CROUCH press as command tokens. Must run before trackTaps updates a.heading.
function trackCommand(a: Actor, mask: InputMask, heading: number): void {
  if (heading >= 0 && heading !== a.heading) pushToken(a, heading);
  const crouching = has(mask, WBIT.CROUCH);
  if (crouching && !a.crouchHeld) pushToken(a, TOK_CROUCH);
  a.crouchHeld = crouching;
}

// Skill whose command ends the buffer for this press, if enabled, affordable and off cooldown; -1 otherwise.
function readySkill(a: Actor, mask: InputMask, heading: number): number {
  if (!a.skills) return -1;
  const idx = matchSkill(a.cmdTok, a.cmdAge, mask & ATTACK_BITS, heading >= 0 ? heading : a.dir);
  if (idx < 0 || a.cd[idx] > 0 || a.stamina < SKILL_DEFS[idx].cost) return -1;
  return idx;
}

// Move chosen by a fresh attack press, from the held weapon, crouch, combo bits and the dash window.
function chooseMove(a: Actor, mask: InputMask, heading: number, allowSkill: boolean): WorldMoveId | null {
  const atkA = has(mask, WBIT.ATK_A);
  const atkB = has(mask, WBIT.ATK_B);
  const atkC = has(mask, WBIT.ATK_C);
  if (a.weapon !== null) {
    if (atkA && atkB) return 'wToss';
    const armedSkill = allowSkill ? readySkill(a, mask, heading) : -1;
    if (armedSkill >= 0) return SKILL_DEFS[armedSkill].move;
    const set = WEAPON_MOVES[a.weapon];
    return atkA ? set[0] : atkB ? set[1] : atkC ? set[2] : null;
  }
  const crouching = has(mask, WBIT.CROUCH);
  if (atkB && atkC) return 'spin';
  if (atkB && a.dashArmed > 0) return 'dash';
  if (crouching && atkB) return 'lowKick';
  if (crouching && atkA) return 'uppercut';
  const skill = allowSkill ? readySkill(a, mask, heading) : -1;
  if (skill >= 0) return SKILL_DEFS[skill].move;
  return atkA ? 'punch' : atkB ? 'kick' : atkC ? 'heavy' : null;
}

function startAttack(a: Actor, move: WorldMoveId, chain: number): void {
  a.state = 'attack';
  a.move = move;
  a.frame = 0;
  a.hitDone = false;
  a.chain = chain;
  if (move === 'dash') a.dashArmed = 0;
  const skill = SKILL_DEFS.findIndex((def) => def.move === move);
  if (skill >= 0) {
    a.stamina -= SKILL_DEFS[skill].cost;
    a.cd[skill] = SKILL_DEFS[skill].cooldown;
    a.cmdTok.fill(-1);
  }
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
  if (a.state === 'roll') {
    walkBy(a, ROLL_SPEED);
    return;
  }
  if (a.state === 'attack' && a.move !== null) {
    const data = WORLD_MOVES[a.move];
    const activeOver = a.frame >= data.startup + data.active;
    if (freshAttack && a.hitDone && activeOver && a.chain < MAX_CHAIN) {
      const next = chooseMove(a, mask, heading, false);
      if (next !== null) {
        if (heading >= 0) a.dir = heading;
        startAttack(a, next, a.chain + 1);
        return;
      }
    }
    if (a.frame < data.startup + data.active) {
      if (a.move === 'dash') walkBy(a, DASH_SPEED);
      else if (a.move === 'blink') walkBy(a, BLINK_SPEED);
    }
    return;
  }
  if (a.state !== 'idle' && a.state !== 'walk' && a.state !== 'run' && a.state !== 'crouch') return;
  if (heading >= 0) a.dir = heading;

  if (freshPickup && tryPickup(a, items)) return;
  if (freshAttack) {
    const move = chooseMove(a, mask, heading, true);
    if (move !== null) {
      startAttack(a, move, 1);
      return;
    }
  }
  if (has(mask, WBIT.CROUCH) && has(mask, WBIT.RUN) && heading >= 0 && a.rollCd === 0) {
    a.state = 'roll';
    a.frame = 0;
    return;
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
  if (data.ranged === true) return false;
  if (att.frame < data.startup || att.frame >= data.startup + data.active) return false;
  if (def.state === 'dead' || def.invuln > 0) return false;
  if (def.state === 'roll' && def.frame < ROLL_SAFE_FRAMES) return false;
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
  if (att.move === 'burst') {
    // Radial knockback: along the attacker-to-defender line (any direction when exactly stacked: none).
    const dx = def.x - att.x;
    const dy = def.y - att.y;
    const d = Math.max(1, Math.floor(Math.sqrt(dx * dx + dy * dy)));
    def.x = clamp(def.x + Math.trunc((push * dx * SUB) / d), MIN_X, MAX_X);
    def.y = clamp(def.y + Math.trunc((push * dy * SUB) / d), MIN_Y, MAX_Y);
  } else {
    def.x = clamp(def.x + Math.trunc((push * DIR_COS[att.dir] * SUB) / 256), MIN_X, MAX_X);
    def.y = clamp(def.y + Math.trunc((push * DIR_SIN[att.dir] * SUB) / 256), MIN_Y, MAX_Y);
  }
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
  trackCommand(a, mask, heading);
  trackTaps(a, heading);
  const freshAttack = (mask & ATTACK_BITS) !== 0 && !a.atkHeld;
  const freshPickup = has(mask, WBIT.PICKUP) && !a.pickHeld;
  applyIntent(a, mask, heading, freshAttack, freshPickup, items);
  a.atkHeld = (mask & ATTACK_BITS) !== 0;
  a.pickHeld = has(mask, WBIT.PICKUP);
}

// The tossed weapon leaves the hand on the first active frame and lands at the throw's reach (gone if it wears out).
function releaseToss(a: Actor, items: Item[]): void {
  if (a.state !== 'attack' || a.move !== 'wToss' || a.frame !== WORLD_MOVES.wToss.startup || a.weapon === null) return;
  const durability = a.durability - 1;
  if (durability > 0) {
    items.push({
      kind: a.weapon,
      x: clamp(a.x + Math.trunc((WEAPON_TOSS_REACH_PX * SUB * DIR_COS[a.dir]) / 256), MIN_X, MAX_X),
      y: clamp(a.y + Math.trunc((WEAPON_TOSS_REACH_PX * SUB * DIR_SIN[a.dir]) / 256), MIN_Y, MAX_Y),
      durability,
    });
  }
  a.weapon = null;
  a.durability = 0;
}

// The projectile leaves the caster on the first active frame of a ranged move.
function spawnProjectile(a: Actor, owner: 0 | 1, projectiles: Projectile[]): void {
  if (a.state !== 'attack' || a.move === null || !isProjectileMove(a.move) || a.frame !== WORLD_MOVES[a.move].startup) return;
  projectiles.push({
    owner,
    move: a.move,
    x: clamp(a.x + Math.trunc((PROJECTILE_SPAWN_PX * SUB * DIR_COS[a.dir]) / 256), 0, WORLD_WIDTH * SUB),
    y: clamp(a.y + Math.trunc((PROJECTILE_SPAWN_PX * SUB * DIR_SIN[a.dir]) / 256), 0, WORLD_HEIGHT * SUB),
    dir: a.dir,
    age: 0,
    hitDone: false,
  });
}

function projectileConnects(p: Projectile, target: Actor): boolean {
  if (p.hitDone || target.state === 'dead' || target.invuln > 0) return false;
  if (target.state === 'roll' && target.frame < ROLL_SAFE_FRAMES) return false;
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  const reach = (BODY_HALF_WIDTH + PROJECTILE_DEFS[p.move].radiusPx) * SUB;
  return dx * dx + dy * dy <= reach * reach;
}

// Moves every projectile one frame, resolves hits against the other fighter and drops the spent or out-of-world ones.
function stepProjectiles(list: Projectile[], player: Actor, general: Actor, items: Item[]): Projectile[] {
  const next: Projectile[] = [];
  for (const p of list) {
    const def = PROJECTILE_DEFS[p.move];
    const q: Projectile = {
      ...p,
      age: p.age + 1,
      x: p.x + Math.trunc((def.speedPx * SUB * DIR_COS[p.dir]) / 256),
      y: p.y + Math.trunc((def.speedPx * SUB * DIR_SIN[p.dir]) / 256),
    };
    if (q.age > def.life || q.x < 0 || q.x > WORLD_WIDTH * SUB || q.y < 0 || q.y > WORLD_HEIGHT * SUB) continue;
    const caster = p.owner === 0 ? player : general;
    const target = p.owner === 0 ? general : player;
    if (projectileConnects(q, target)) {
      applyHit({ ...caster, move: q.move, dir: q.dir, chain: 1 }, target, items);
      if (!def.pierce) continue;
      q.hitDone = true;
    }
    next.push(q);
  }
  return next;
}

export function stepWorld(state: WorldState, inputs: [InputMask, InputMask]): WorldState {
  const player = cloneActor(state.player);
  const general = cloneActor(state.general);
  const items = state.items.map((i) => ({ ...i }));
  const projectiles = state.projectiles.map((p) => ({ ...p }));

  advanceTimers(player);
  advanceTimers(general);
  act(player, inputs[0], items);
  act(general, inputs[1], items);
  releaseToss(player, items);
  releaseToss(general, items);
  spawnProjectile(player, 0, projectiles);
  spawnProjectile(general, 1, projectiles);
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

  const flying = stepProjectiles(projectiles, player, general, items);

  return { tick: state.tick + 1, rng: nextRandom(state.rng)[1], player, general, items, projectiles: flying };
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
    h = mix(h, a.rollCd);
    h = mix(h, a.skills ? 1 : 0);
    h = mix(h, a.stamina);
    for (const v of a.cd) h = mix(h, v);
    for (const v of a.cmdTok) h = mix(h, v);
    for (const v of a.cmdAge) h = mix(h, v);
    h = mix(h, a.crouchHeld ? 1 : 0);
  }
  h = mix(h, state.items.length);
  for (const item of state.items) {
    h = mix(h, WEAPON_INDEX[item.kind]);
    h = mix(h, item.x);
    h = mix(h, item.y);
    h = mix(h, item.durability);
  }
  // Only mixed when something is flying, so hashes of projectile-free states stay what they were before projectiles existed.
  if (state.projectiles.length > 0) {
    h = mix(h, state.projectiles.length);
    for (const p of state.projectiles) {
      h = mix(h, p.owner);
      h = mix(h, MOVE_INDEX[p.move]);
      h = mix(h, p.x);
      h = mix(h, p.y);
      h = mix(h, p.dir);
      h = mix(h, p.age);
      h = mix(h, p.hitDone ? 1 : 0);
    }
  }
  return h >>> 0;
}

// World plus its NPC, seeded the same way for the live game and for replays.
export function createWorldSession(seed: number): { world: WorldState; npc: WorldNpcState } {
  return { world: createWorld(seed, { playerSkills: true }), npc: createWorldNpc((seed ^ NPC_SEED_XOR) >>> 0) };
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
