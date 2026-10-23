import { BODY_HALF_WIDTH, MAX_HP, SUB } from '../frame-data.ts';
import { DIR_COS, DIR_SIN } from './dirs.ts';
import { WEAPON_DURABILITY, WORLD_MOVES } from './moves.ts';
import type { WeaponKind, WorldMoveId } from './moves.ts';
import { MAX_CHAIN, TAP_WINDOW, WORLD_HEIGHT, WORLD_WIDTH } from './sim.ts';
import type { Actor, ActorStateName, WorldState } from './sim.ts';

export type Side = 'player' | 'general';

// Bump whenever the layout or meaning of any feature changes: brains trained with another version are rejected.
export const FEATURES_VERSION = 1;

const STATES: readonly ActorStateName[] = ['idle', 'walk', 'run', 'crouch', 'attack', 'pickup', 'hitstun', 'dead'];
const MOVES: readonly WorldMoveId[] = [
  'punch', 'kick', 'heavy', 'lowKick', 'uppercut', 'spin', 'dash',
  'wThrust', 'wSweep', 'wChop', 'sThrust', 'sSweep', 'sChop',
];
const WEAPONS: readonly WeaponKind[] = ['spear', 'staff'];

const NEAR_SCALE_PX = 400; // relative offsets and wall distances saturate at this many px
const REACH_PX = WORLD_MOVES.kick.reachPx + BODY_HALF_WIDTH; // distance scale for "in kick range"
const STUN_SCALE = 30; // frames; hitstun values are at most 24

// 3 offsets + 2 own facing + 2 opp facing + 2 relative angle + 2 hp
// + 16 states + 2*(progress + 3 phases + stun left) + 13 opp move + chain block 5 + 2 invuln
// + 2*(2 kinds + durability) + 4 ground weapon + 4 walls
export const FEATURE_COUNT = 3 + 2 + 2 + 2 + 2 + 16 + 10 + 13 + 5 + 2 + 6 + 4 + 4;

function clip(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function unit(v: number): number {
  return clip(v, -1, 1);
}

function pushActorPhase(out: number[], a: Actor): void {
  let progress = 0;
  let startup = 0;
  let active = 0;
  let recovery = 0;
  if (a.state === 'attack' && a.move !== null) {
    const d = WORLD_MOVES[a.move];
    const total = d.startup + d.active + d.recovery;
    progress = clip(a.frame / total, 0, 1);
    if (a.frame < d.startup) startup = 1;
    else if (a.frame < d.startup + d.active) active = 1;
    else recovery = 1;
  }
  const stunLeft = a.state === 'hitstun' ? clip((a.stun - a.frame) / STUN_SCALE, 0, 1) : 0;
  out.push(progress, startup, active, recovery, stunLeft);
}

function pushWeapon(out: number[], a: Actor): void {
  for (const kind of WEAPONS) out.push(a.weapon === kind ? 1 : 0);
  out.push(a.weapon === null ? 0 : clip(a.durability / WEAPON_DURABILITY[a.weapon], 0, 1));
}

// Fixed-length vector from `side`'s point of view. Pure and deterministic; every value is in [-1, 1].
export function featurize(world: WorldState, side: Side): number[] {
  const me = side === 'general' ? world.general : world.player;
  const foe = side === 'general' ? world.player : world.general;
  const out: number[] = [];

  const dx = (foe.x - me.x) / SUB;
  const dy = (foe.y - me.y) / SUB;
  const dist = Math.sqrt(dx * dx + dy * dy);
  out.push(unit(dx / NEAR_SCALE_PX), unit(dy / NEAR_SCALE_PX), clip(dist / REACH_PX / 4, 0, 1));

  const fx = DIR_COS[me.dir % 16] / 256;
  const fy = DIR_SIN[me.dir % 16] / 256;
  out.push(fy, fx, DIR_SIN[foe.dir % 16] / 256, DIR_COS[foe.dir % 16] / 256);
  // Angle between my facing and the direction to the opponent: (0, 1) = looking straight at them.
  const tx = dist > 0 ? dx / dist : 0;
  const ty = dist > 0 ? dy / dist : 0;
  out.push(unit(fx * ty - fy * tx), unit(fx * tx + fy * ty));

  out.push(me.hp / MAX_HP, foe.hp / MAX_HP);
  for (const a of [me, foe]) for (const s of STATES) out.push(a.state === s ? 1 : 0);
  pushActorPhase(out, me);
  pushActorPhase(out, foe);
  for (const m of MOVES) out.push(foe.state === 'attack' && foe.move === m ? 1 : 0);

  out.push(
    me.chain / MAX_CHAIN,
    me.hitDone ? 1 : 0,
    me.dashArmed / TAP_WINDOW,
    me.lastTapDir >= 0 ? clip(1 - me.tapAge / TAP_WINDOW, 0, 1) : 0, // open double-tap window left
    foe.chain / MAX_CHAIN,
  );
  out.push(me.invuln > 0 ? 1 : 0, foe.invuln > 0 ? 1 : 0);

  pushWeapon(out, me);
  pushWeapon(out, foe);

  let best: { dx: number; dy: number; d: number } | null = null;
  for (const item of world.items) {
    const ix = (item.x - me.x) / SUB;
    const iy = (item.y - me.y) / SUB;
    const d = Math.sqrt(ix * ix + iy * iy);
    if (best === null || d < best.d) best = { dx: ix, dy: iy, d };
  }
  if (best === null || me.weapon !== null) out.push(0, 0, 0, 0);
  else out.push(unit(best.dx / NEAR_SCALE_PX), unit(best.dy / NEAR_SCALE_PX), clip(best.d / NEAR_SCALE_PX, 0, 1), 1);

  const px = me.x / SUB;
  const py = me.y / SUB;
  out.push(
    clip(px / NEAR_SCALE_PX, 0, 1),
    clip((WORLD_WIDTH - px) / NEAR_SCALE_PX, 0, 1),
    clip(py / NEAR_SCALE_PX, 0, 1),
    clip((WORLD_HEIGHT - py) / NEAR_SCALE_PX, 0, 1),
  );
  return out;
}
