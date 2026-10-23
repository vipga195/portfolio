import { MOVES } from '../frame-data.ts';

export type WeaponKind = 'spear' | 'staff';
export type MoveLevel = 'high' | 'mid' | 'low';
export type WorldMoveId =
  | 'punch'
  | 'kick'
  | 'heavy'
  | 'lowKick'
  | 'uppercut'
  | 'spin'
  | 'dash'
  | 'blink'
  | 'burst'
  | 'wThrust'
  | 'wSweep'
  | 'wChop'
  | 'sThrust'
  | 'sSweep'
  | 'sChop';

export type WorldMoveData = {
  startup: number;
  active: number;
  recovery: number;
  damage: number; // out of MAX_HP
  hitstun: number;
  reachPx: number;
  arcSteps: number; // half-width of the fan in 22.5 degree steps; 8 or more = full circle
  level: MoveLevel;
  knockbackPx: number;
  armed: boolean; // weapon move: spends durability on a hit and gets no unarmed chain bonus
};

export const PICKUP_RANGE_PX = 40;
export const PICKUP_FRAMES = 8;
export const WEAPON_DURABILITY: Record<WeaponKind, number> = { spear: 14, staff: 24 };

function unarmed(
  startup: number,
  active: number,
  recovery: number,
  damage: number,
  hitstun: number,
  reachPx: number,
  arcSteps: number,
  level: MoveLevel,
  knockbackPx: number,
): WorldMoveData {
  return { startup, active, recovery, damage, hitstun, reachPx, arcSteps, level, knockbackPx, armed: false };
}

function weapon(base: 'thrust' | 'sweep' | 'chop', arcSteps: number, knockbackPx: number, reachPx: number, damagePct: number): WorldMoveData {
  const m = MOVES[base];
  return {
    startup: m.startup,
    active: m.active,
    recovery: m.recovery,
    damage: Math.trunc((m.damage * damagePct) / 100),
    hitstun: m.hitstun,
    reachPx,
    arcSteps,
    level: m.level,
    knockbackPx,
    armed: true,
  };
}

export const WORLD_MOVES: Record<WorldMoveId, WorldMoveData> = {
  punch: unarmed(5, 3, 9, 45, 12, 48, 3, 'mid', 14),
  kick: unarmed(9, 4, 15, 75, 16, 66, 2, 'mid', 24),
  heavy: unarmed(17, 4, 24, 120, 22, 72, 2, 'high', 48),
  lowKick: unarmed(10, 4, 16, 70, 18, 62, 2, 'low', 18),
  uppercut: unarmed(6, 4, 20, 110, 24, 50, 2, 'mid', 40),
  spin: unarmed(10, 5, 22, 90, 18, 70, 8, 'mid', 30),
  dash: unarmed(6, 6, 18, 100, 20, 60, 2, 'mid', 30),
  blink: unarmed(4, 8, 24, 160, 26, 50, 2, 'mid', 40),
  burst: unarmed(8, 4, 20, 70, 22, 120, 8, 'mid', 90),
  wThrust: weapon('thrust', 1, 20, MOVES.thrust.reachPx, 100),
  wSweep: weapon('sweep', 3, 28, MOVES.sweep.reachPx, 100),
  wChop: weapon('chop', 2, 44, MOVES.chop.reachPx, 100),
  sThrust: weapon('thrust', 1, 20, 110, 85),
  sSweep: weapon('sweep', 3, 28, 100, 85),
  sChop: weapon('chop', 2, 44, 90, 85),
};

// Weapon move ids for ATK_A / ATK_B / ATK_C.
export const WEAPON_MOVES: Record<WeaponKind, readonly [WorldMoveId, WorldMoveId, WorldMoveId]> = {
  spear: ['wThrust', 'wSweep', 'wChop'],
  staff: ['sThrust', 'sSweep', 'sChop'],
};
