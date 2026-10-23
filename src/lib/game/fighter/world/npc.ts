import { nextRandom } from '../../../rng.ts';
import { SUB } from '../frame-data.ts';
import type { InputMask } from '../inputs.ts';
import { PICKUP_RANGE_PX, WEAPON_MOVES, WORLD_MOVES } from './moves.ts';
import type { Item, WorldState } from './sim.ts';
import { WBIT } from './winputs.ts';

export type WorldNpcState = { seed: number; mask: InputMask; hold: number; seek: boolean };

const DECISION_INTERVAL = 24;
// Thresholds on the raw u32 from the generator (u32 < N means probability N / 2^32).
const RETREAT_BELOW = 858993459; // ~20%
const MAJOR_BELOW = 2576980378; // ~60%
const MINOR_BELOW = 3435973837; // ~80%
const SEEK_BELOW = 1431655765; // ~33%
const SEEK_RANGE = 200 * SUB;
// Stop short of the sim's pickup range so the press always lands.
const GRAB_RANGE = (PICKUP_RANGE_PX - 4) * SUB;
const PUNCH_REACH = WORLD_MOVES.punch.reachPx * SUB;
const KICK_REACH = WORLD_MOVES.kick.reachPx * SUB;

export function createWorldNpc(seed: number): WorldNpcState {
  return { seed: seed >>> 0, mask: 0, hold: 0, seek: false };
}

// Direction bits pointing along (dx, dy): an axis is pressed when it exceeds ~0.4 of the larger one (about tan 22.5 degrees).
function headingMask(dx: number, dy: number): InputMask {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const big = ax > ay ? ax : ay;
  let mask = 0;
  if (ax * 5 > big * 2) mask |= dx > 0 ? WBIT.RIGHT : WBIT.LEFT;
  if (ay * 5 > big * 2) mask |= dy > 0 ? WBIT.DOWN : WBIT.UP;
  return mask;
}

function opposite(mask: InputMask): InputMask {
  let out = 0;
  if (mask & WBIT.LEFT) out |= WBIT.RIGHT;
  if (mask & WBIT.RIGHT) out |= WBIT.LEFT;
  if (mask & WBIT.UP) out |= WBIT.DOWN;
  if (mask & WBIT.DOWN) out |= WBIT.UP;
  return out;
}

// Nearest item to (x, y) with its squared distance; ties go to the lowest index.
function nearestItem(x: number, y: number, items: Item[]): { item: Item; d2: number } | null {
  let best: { item: Item; d2: number } | null = null;
  for (const item of items) {
    const dx = item.x - x;
    const dy = item.y - y;
    const d2 = dx * dx + dy * dy;
    if (best === null || d2 < best.d2) best = { item, d2 };
  }
  return best;
}

// Pure: returns this frame's input mask for the general and the next NPC state.
// Level 1: decides every 24 frames; unarmed it fights with hands and feet or fetches a nearby weapon,
// armed it fights at the weapon's reach; in range it attacks or backs off.
export function npcStepWorld(npc: WorldNpcState, world: WorldState): [InputMask, WorldNpcState] {
  const me = world.general;
  const target = world.player;

  // Nothing to decide while stunned, attacking, picking up or dead; decide afresh as soon as control returns.
  if (me.state === 'attack' || me.state === 'hitstun' || me.state === 'dead' || me.state === 'pickup') {
    return [0, { ...npc, mask: 0, hold: 0, seek: false }];
  }

  // Walking to a weapon: re-aim every frame and press PICKUP once close enough.
  if (npc.seek) {
    const near = nearestItem(me.x, me.y, world.items);
    if (me.weapon === null && near !== null) {
      if (near.d2 <= GRAB_RANGE * GRAB_RANGE) return [WBIT.PICKUP, { ...npc, mask: 0, hold: 0, seek: false }];
      return [headingMask(near.item.x - me.x, near.item.y - me.y), npc];
    }
  }
  if (npc.hold > 0) return [npc.mask, { ...npc, hold: npc.hold - 1, seek: false }];

  let seed = npc.seed;
  // Raw u32: nextRandom returns u32 / 2^32, so the product is an exact integer.
  const roll = (): number => {
    const [v, next] = nextRandom(seed);
    seed = next;
    return Math.floor(v * 4294967296);
  };

  if (me.weapon === null) {
    const near = nearestItem(me.x, me.y, world.items);
    if (near !== null && near.d2 <= SEEK_RANGE * SEEK_RANGE && roll() < SEEK_BELOW) {
      const mask = headingMask(near.item.x - me.x, near.item.y - me.y);
      return [mask, { seed, mask, hold: 0, seek: true }];
    }
  }

  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const toward = headingMask(dx, dy);
  const d2 = dx * dx + dy * dy;
  const moves = me.weapon === null ? null : WEAPON_MOVES[me.weapon];
  const engage = moves === null ? KICK_REACH : WORLD_MOVES[moves[0]].reachPx * SUB;

  let mask: InputMask;
  if (target.state === 'dead' || d2 > engage * engage) {
    mask = toward;
  } else if (roll() < RETREAT_BELOW) {
    mask = opposite(toward);
  } else if (moves !== null) {
    const chopReach = WORLD_MOVES[moves[2]].reachPx * SUB;
    if (d2 >= chopReach * chopReach) mask = toward | (roll() < MAJOR_BELOW ? WBIT.ATK_A : WBIT.ATK_B);
    else mask = toward | (roll() < MAJOR_BELOW ? WBIT.ATK_C : WBIT.ATK_A);
  } else {
    const r = roll();
    if (d2 <= PUNCH_REACH * PUNCH_REACH) mask = toward | (r < MAJOR_BELOW ? WBIT.ATK_A : r < MINOR_BELOW ? WBIT.ATK_B : WBIT.ATK_C);
    else mask = toward | (r < MINOR_BELOW ? WBIT.ATK_B : WBIT.ATK_C);
  }
  return [mask, { seed, mask, hold: DECISION_INTERVAL - 1, seek: false }];
}
