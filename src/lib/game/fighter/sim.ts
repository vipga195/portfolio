import { nextRandom } from '../../rng.ts';
import {
  BACK_SPEED,
  BLOCK_CHIP_DIVISOR,
  BODY_HALF_WIDTH,
  GETUP_FRAMES,
  GRAVITY,
  JUMP_VY,
  KNOCKBACK_SPEED,
  KNOCKDOWN_FRAMES,
  MAX_HP,
  MOVES,
  ROUND_FRAMES,
  START_X_P1,
  START_X_P2,
  STAGE_WIDTH,
  SUB,
  WALK_SPEED,
} from './frame-data.ts';
import type { MoveId } from './frame-data.ts';
import { BIT, has } from './inputs.ts';
import type { InputMask } from './inputs.ts';

export type FighterStateName =
  | 'idle'
  | 'walk'
  | 'jump'
  | 'crouch'
  | 'attack'
  | 'blockstun'
  | 'hitstun'
  | 'knockdown'
  | 'getup';

export type Fighter = {
  x: number; // subpx, horizontal
  y: number; // subpx above ground, 0 = grounded
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  state: FighterStateName;
  frame: number; // frames spent in the current attack or stun state
  move: MoveId | null;
  hitDone: boolean;
  stun: number; // total duration of the current stun state
};

export type FightState = {
  tick: number;
  seed: number;
  fighters: [Fighter, Fighter];
  winner: 0 | 1 | 2 | null; // 1/2 = that player won, 0 = draw
};

const MIN_X = BODY_HALF_WIDTH * SUB;
const MAX_X = (STAGE_WIDTH - BODY_HALF_WIDTH) * SUB;
const MIN_GAP = 2 * BODY_HALF_WIDTH * SUB;
const LOW_WHIFF_HEIGHT = 40 * SUB;

const STATE_INDEX: Record<FighterStateName, number> = {
  idle: 0,
  walk: 1,
  jump: 2,
  crouch: 3,
  attack: 4,
  blockstun: 5,
  hitstun: 6,
  knockdown: 7,
  getup: 8,
};

const MOVE_INDEX: Record<MoveId, number> = { thrust: 0, sweep: 1, chop: 2, lowSweep: 3 };

function makeFighter(xPx: number, facing: 1 | -1): Fighter {
  return {
    x: xPx * SUB,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    hp: MAX_HP,
    state: 'idle',
    frame: 0,
    move: null,
    hitDone: false,
    stun: 0,
  };
}

export function createFight(seed: number): FightState {
  return {
    tick: 0,
    seed: seed >>> 0,
    fighters: [makeFighter(START_X_P1, 1), makeFighter(START_X_P2, -1)],
    winner: null,
  };
}

function isAirborne(f: Fighter): boolean {
  return f.y > 0 || f.vy > 0;
}

function dirToward(f: Fighter, opp: Fighter): 1 | -1 {
  if (opp.x === f.x) return f.facing;
  return opp.x > f.x ? 1 : -1;
}

// Leaves a stun/attack state: back to idle, or to jump if the fighter is still in the air.
function recover(f: Fighter): void {
  f.state = isAirborne(f) ? 'jump' : 'idle';
  f.frame = 0;
  f.move = null;
  f.hitDone = false;
  f.stun = 0;
  f.vx = 0;
}

// Advances the timers of attack and stun states.
function advanceTimers(f: Fighter): void {
  switch (f.state) {
    case 'attack': {
      if (f.move === null) {
        recover(f);
        return;
      }
      const { startup, active, recovery } = MOVES[f.move];
      f.frame += 1;
      if (f.frame >= startup + active + recovery) recover(f);
      return;
    }
    case 'blockstun':
    case 'hitstun':
      f.frame += 1;
      if (f.frame >= f.stun) recover(f);
      return;
    case 'knockdown':
      f.frame += 1;
      if (f.frame >= f.stun) {
        f.state = 'getup';
        f.frame = 0;
        f.stun = GETUP_FRAMES;
        f.vx = 0;
      }
      return;
    case 'getup':
      f.frame += 1;
      if (f.frame >= f.stun) recover(f);
      return;
    default:
      return;
  }
}

function pickAttack(mask: InputMask): MoveId | null {
  if (has(mask, BIT.THRUST)) return 'thrust';
  if (has(mask, BIT.SWEEP)) return has(mask, BIT.DOWN) ? 'lowSweep' : 'sweep';
  if (has(mask, BIT.CHOP)) return 'chop';
  return null;
}

// Step (a): turn the input into movement, a jump or an attack.
function applyIntent(f: Fighter, opp: Fighter, mask: InputMask): void {
  if (f.state !== 'idle' && f.state !== 'walk' && f.state !== 'crouch') return;
  if (isAirborne(f)) return;
  const toward = dirToward(f, opp);
  const left = has(mask, BIT.LEFT);
  const right = has(mask, BIT.RIGHT);
  const dir = left === right ? 0 : right ? 1 : -1;

  const move = pickAttack(mask);
  if (move !== null) {
    f.state = 'attack';
    f.move = move;
    f.frame = 0;
    f.hitDone = false;
    f.vx = 0;
    f.facing = toward;
    return;
  }
  if (has(mask, BIT.UP)) {
    f.state = 'jump';
    f.vy = JUMP_VY;
    f.vx = dir * WALK_SPEED;
    f.facing = toward;
    return;
  }
  if (has(mask, BIT.DOWN)) {
    f.state = 'crouch';
    f.vx = 0;
    return;
  }
  if (dir !== 0) {
    f.state = 'walk';
    f.vx = dir * (dir === toward ? WALK_SPEED : BACK_SPEED);
    return;
  }
  f.state = 'idle';
  f.vx = 0;
}

function clampX(x: number): number {
  return x < MIN_X ? MIN_X : x > MAX_X ? MAX_X : x;
}

// Step (b): integrate position, gravity, stage bounds and body separation.
function integrate(fighters: [Fighter, Fighter]): void {
  for (const f of fighters) {
    f.x = clampX(f.x + f.vx);
    if (isAirborne(f)) {
      f.y += f.vy;
      f.vy -= GRAVITY;
      if (f.y <= 0) {
        f.y = 0;
        f.vy = 0;
        if (f.state === 'jump') {
          f.state = 'idle';
          f.vx = 0;
        }
      }
    }
  }

  const [a, b] = fighters;
  if (a.y === 0 && b.y === 0) {
    const [left, right] = a.x <= b.x ? [a, b] : [b, a];
    const overlap = MIN_GAP - (right.x - left.x);
    if (overlap > 0) {
      const leftShift = Math.ceil(overlap / 2);
      left.x = clampX(left.x - leftShift);
      right.x = clampX(right.x + (overlap - leftShift));
      if (right.x - left.x < MIN_GAP) {
        // One of them is against a wall: the other takes the rest of the push.
        if (left.x === MIN_X) right.x = left.x + MIN_GAP;
        else left.x = right.x - MIN_GAP;
      }
    }
  }

  for (let i = 0; i < 2; i++) {
    const f = fighters[i];
    const opp = fighters[1 - i];
    if (f.y === 0 && f.state !== 'attack' && opp.x !== f.x) f.facing = dirToward(f, opp);
  }
}

type HitResult = { blocked: boolean };

// Step (c) for one attacker against a snapshot of both fighters; null means no connection.
function evaluateHit(att: Fighter, def: Fighter, defMask: InputMask): HitResult | null {
  if (att.state !== 'attack' || att.move === null || att.hitDone) return null;
  const data = MOVES[att.move];
  if (att.frame < data.startup || att.frame >= data.startup + data.active) return null;
  if (def.state === 'knockdown' || def.state === 'getup') return null;

  const dx = def.x - att.x;
  if (Math.abs(dx) > (data.reachPx + BODY_HALF_WIDTH) * SUB) return null;
  if (dx * att.facing < 0) return null;
  if (data.level === 'high' && def.state === 'crouch') return null;
  if (data.level === 'low' && def.y > LOW_WHIFF_HEIGHT) return null;

  const canBlock = (def.state === 'idle' || def.state === 'walk' || def.state === 'crouch') && def.y === 0;
  if (canBlock) {
    const awaySign = dx === 0 ? att.facing : dx > 0 ? 1 : -1;
    const holdsAway = has(defMask, awaySign === 1 ? BIT.RIGHT : BIT.LEFT);
    const lowOk = data.level !== 'low' || has(defMask, BIT.DOWN);
    if (holdsAway && lowOk) return { blocked: true };
  }
  return { blocked: false };
}

function applyHit(att: Fighter, def: Fighter, result: HitResult): void {
  if (att.move === null) return;
  const data = MOVES[att.move];
  const away = def.x === att.x ? att.facing : def.x > att.x ? 1 : -1;
  def.move = null;
  def.hitDone = false;
  def.frame = 0;
  if (result.blocked) {
    def.hp -= Math.floor(data.damage / BLOCK_CHIP_DIVISOR);
    def.state = 'blockstun';
    def.stun = data.blockstun;
    def.vx = away * (KNOCKBACK_SPEED / 2);
    return;
  }
  def.hp -= data.damage;
  if (data.knockdown) {
    def.state = 'knockdown';
    def.stun = KNOCKDOWN_FRAMES;
    def.vx = 0;
  } else {
    def.state = 'hitstun';
    def.stun = data.hitstun;
    def.vx = away * KNOCKBACK_SPEED;
  }
}

export function stepFight(state: FightState, inputs: [InputMask, InputMask]): FightState {
  if (state.winner !== null) return state;

  const fighters: [Fighter, Fighter] = [{ ...state.fighters[0] }, { ...state.fighters[1] }];

  // (a) timers and intent
  for (const f of fighters) advanceTimers(f);
  applyIntent(fighters[0], fighters[1], inputs[0]);
  applyIntent(fighters[1], fighters[0], inputs[1]);

  // (b) movement
  integrate(fighters);

  // (c) hits, evaluated against the state at the start of this step
  const snap: [Fighter, Fighter] = [{ ...fighters[0] }, { ...fighters[1] }];
  const hit0 = evaluateHit(snap[0], snap[1], inputs[1]);
  const hit1 = evaluateHit(snap[1], snap[0], inputs[0]);
  if (hit0 !== null) applyHit(snap[0], fighters[1], hit0);
  if (hit1 !== null) applyHit(snap[1], fighters[0], hit1);
  // Mark the attacks that connected (a fighter hit in a trade has already left its attack state).
  if (hit0 !== null && fighters[0].state === 'attack') fighters[0].hitDone = true;
  if (hit1 !== null && fighters[1].state === 'attack') fighters[1].hitDone = true;

  // (d) outcome
  for (const f of fighters) if (f.hp < 0) f.hp = 0;
  const tick = state.tick + 1;
  let winner: 0 | 1 | 2 | null = null;
  if (fighters[0].hp <= 0 && fighters[1].hp <= 0) winner = 0;
  else if (fighters[0].hp <= 0) winner = 2;
  else if (fighters[1].hp <= 0) winner = 1;
  else if (tick >= ROUND_FRAMES) {
    winner = fighters[0].hp > fighters[1].hp ? 1 : fighters[1].hp > fighters[0].hp ? 2 : 0;
  }

  return { tick, seed: nextRandom(state.seed)[1], fighters, winner };
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
export function hashFight(state: FightState): number {
  let h = 0x811c9dc5;
  h = mix(h, state.tick);
  h = mix(h, state.seed);
  h = mix(h, state.winner === null ? -1 : state.winner);
  for (const f of state.fighters) {
    h = mix(h, f.x);
    h = mix(h, f.y);
    h = mix(h, f.vx);
    h = mix(h, f.vy);
    h = mix(h, f.facing);
    h = mix(h, f.hp);
    h = mix(h, STATE_INDEX[f.state]);
    h = mix(h, f.frame);
    h = mix(h, f.move === null ? -1 : MOVE_INDEX[f.move]);
    h = mix(h, f.hitDone ? 1 : 0);
    h = mix(h, f.stun);
  }
  return h >>> 0;
}

// Runs a whole round; missing inputs count as 0 (idle). Always ends with a winner (at the latest at ROUND_FRAMES).
export function simulate(seed: number, p1: InputMask[], p2: InputMask[]): FightState {
  let state = createFight(seed);
  while (state.winner === null) {
    state = stepFight(state, [p1[state.tick] ?? 0, p2[state.tick] ?? 0]);
  }
  return state;
}
