import { nextRandom } from '../../../rng.ts';
import { MOVES, SUB } from '../frame-data.ts';
import { BIT } from '../inputs.ts';
import type { InputMask } from '../inputs.ts';
import type { WorldState } from './sim.ts';

export type WorldNpcState = { seed: number; mask: InputMask; hold: number };

const DECISION_INTERVAL = 24;
const RETREAT_CHANCE = 0.2;
const THRUST_CHANCE = 0.6;
const THRUST_REACH = MOVES.thrust.reachPx * SUB;
const CHOP_REACH = MOVES.chop.reachPx * SUB;

export function createWorldNpc(seed: number): WorldNpcState {
  return { seed: seed >>> 0, mask: 0, hold: 0 };
}

// Direction bits pointing along (dx, dy): an axis is pressed when it exceeds ~0.4 of the larger one (about tan 22.5 degrees).
function headingMask(dx: number, dy: number): InputMask {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const big = ax > ay ? ax : ay;
  let mask = 0;
  if (ax * 5 > big * 2) mask |= dx > 0 ? BIT.RIGHT : BIT.LEFT;
  if (ay * 5 > big * 2) mask |= dy > 0 ? BIT.DOWN : BIT.UP;
  return mask;
}

function opposite(mask: InputMask): InputMask {
  let out = 0;
  if (mask & BIT.LEFT) out |= BIT.RIGHT;
  if (mask & BIT.RIGHT) out |= BIT.LEFT;
  if (mask & BIT.UP) out |= BIT.DOWN;
  if (mask & BIT.DOWN) out |= BIT.UP;
  return out;
}

// Pure: returns this frame's input mask for the general and the next NPC state.
// Level 1: decides every 24 frames; approach until in range, then attack or back off.
export function npcStepWorld(npc: WorldNpcState, world: WorldState): [InputMask, WorldNpcState] {
  const me = world.general;
  const target = world.player;

  // Nothing to decide while stunned, attacking or dead; decide afresh as soon as control returns.
  if (me.state === 'attack' || me.state === 'hitstun' || me.state === 'dead') return [0, { ...npc, mask: 0, hold: 0 }];
  if (npc.hold > 0) return [npc.mask, { ...npc, hold: npc.hold - 1 }];

  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const toward = headingMask(dx, dy);
  const d2 = dx * dx + dy * dy;
  let seed = npc.seed;
  const roll = (): number => {
    const [v, next] = nextRandom(seed);
    seed = next;
    return v;
  };

  let mask: InputMask;
  if (target.state === 'dead' || d2 > THRUST_REACH * THRUST_REACH) {
    mask = toward;
  } else if (roll() < RETREAT_CHANCE) {
    mask = opposite(toward);
  } else if (d2 >= CHOP_REACH * CHOP_REACH) {
    mask = toward | (roll() < THRUST_CHANCE ? BIT.THRUST : BIT.SWEEP);
  } else {
    mask = toward | (roll() < THRUST_CHANCE ? BIT.CHOP : BIT.THRUST);
  }
  return [mask, { seed, mask, hold: DECISION_INTERVAL - 1 }];
}
