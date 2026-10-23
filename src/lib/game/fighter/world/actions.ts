import { SUB } from '../frame-data.ts';
import type { InputMask } from '../inputs.ts';
import { PICKUP_RANGE_PX } from './moves.ts';
import type { Side } from './features.ts';
import type { WorldState } from './sim.ts';
import { WBIT } from './winputs.ts';

// Bump whenever an action index changes meaning: brains trained with another layout are rejected.
export const ACTIONS_VERSION = 1;

// The agent decides every DECISION_FRAMES sim frames (10 decisions per second at 60 FPS). A simple macro holds its
// mask for the whole interval; attack macros press for one frame and release, because the sim only starts an attack
// (or chain link) on a fresh press. Scripted macros (chain, dash) are longer and simply occupy more frames.
export const DECISION_FRAMES = 6;

export const ACTION_NAMES = [
  'idle',
  'walkToward',
  'walkAway',
  'strafeLeft',
  'strafeRight',
  'runToward',
  'attackA', // punch, or the weapon's thrust when armed
  'attackB', // kick, or the weapon's sweep when armed
  'attackC', // heavy, or the weapon's chop when armed
  'chain', // A, A, B timed to cancel on hit: the third link of an unarmed chain does +30% damage
  'uppercut', // crouch + A
  'spin', // B + C
  'dashKick', // double-tap toward the target, then B
  'lowKick', // crouch + B
  'pickup', // drop the held weapon, else fetch the nearest one and grab it in range
] as const;
export const ACTION_COUNT = ACTION_NAMES.length;

// Frame offsets (from the macro start) of the chain presses: a link can cancel once its active frames are over
// (punch: 5 startup + 3 active = frame 8) and only when the previous link hit.
const CHAIN_SECOND_AT = 8;
const CHAIN_THIRD_AT = 16;
const CHAIN_FRAMES = 20;
const GRAB_RANGE = (PICKUP_RANGE_PX - 4) * SUB; // stop short of the sim's pickup range so the press lands

// Direction bits pointing along (dx, dy): an axis is pressed when it exceeds ~0.4 of the larger one.
function headingMask(dx: number, dy: number): InputMask {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const big = ax > ay ? ax : ay;
  let mask = 0;
  if (ax * 5 > big * 2) mask |= dx > 0 ? WBIT.RIGHT : WBIT.LEFT;
  if (ay * 5 > big * 2) mask |= dy > 0 ? WBIT.DOWN : WBIT.UP;
  return mask;
}

function held(mask: InputMask): InputMask[] {
  return new Array<InputMask>(DECISION_FRAMES).fill(mask);
}

const DIRECTION_BITS = WBIT.LEFT | WBIT.RIGHT | WBIT.UP | WBIT.DOWN;

// One-frame button press, then only the direction stays held for the rest of the interval. Releasing the buttons
// makes the next press fresh; keeping the direction avoids an accidental double-tap (which would arm a dash kick).
function press(mask: InputMask, length: number = DECISION_FRAMES): InputMask[] {
  const frames = new Array<InputMask>(length).fill(mask & DIRECTION_BITS);
  frames[0] = mask;
  return frames;
}

// Per-frame input masks for `action` as played by `side`, planned from the current world. Pure and deterministic.
export function actionFrames(action: number, world: WorldState, side: Side): InputMask[] {
  const me = side === 'general' ? world.general : world.player;
  const foe = side === 'general' ? world.player : world.general;
  const dx = foe.x - me.x;
  const dy = foe.y - me.y;
  const toward = headingMask(dx, dy);
  switch (action) {
    case 1:
      return held(toward);
    case 2:
      return held(headingMask(-dx, -dy));
    case 3:
      return held(headingMask(dy, -dx));
    case 4:
      return held(headingMask(-dy, dx));
    case 5:
      return held(toward | WBIT.RUN);
    case 6:
      return press(toward | WBIT.ATK_A);
    case 7:
      return press(toward | WBIT.ATK_B);
    case 8:
      return press(toward | WBIT.ATK_C);
    case 9: {
      const frames = press(toward | WBIT.ATK_A, CHAIN_FRAMES);
      frames[CHAIN_SECOND_AT] = toward | WBIT.ATK_A;
      frames[CHAIN_THIRD_AT] = toward | WBIT.ATK_B;
      return frames;
    }
    case 10:
      return press(toward | WBIT.CROUCH | WBIT.ATK_A);
    case 11:
      return press(toward | WBIT.ATK_B | WBIT.ATK_C);
    case 12: {
      // Neutral first so the first press is a tap, then release, then tap again together with B inside the window.
      const frames = new Array<InputMask>(DECISION_FRAMES).fill(0);
      frames[1] = toward;
      frames[3] = toward | WBIT.ATK_B;
      return frames;
    }
    case 13:
      return press(toward | WBIT.CROUCH | WBIT.ATK_B);
    case 14: {
      if (me.weapon !== null) return press(WBIT.PICKUP);
      let best: { dx: number; dy: number; d2: number } | null = null;
      for (const item of world.items) {
        const ix = item.x - me.x;
        const iy = item.y - me.y;
        const d2 = ix * ix + iy * iy;
        if (best === null || d2 < best.d2) best = { dx: ix, dy: iy, d2 };
      }
      if (best === null) return held(0);
      if (best.d2 <= GRAB_RANGE * GRAB_RANGE) return press(WBIT.PICKUP);
      return held(headingMask(best.dx, best.dy));
    }
    default:
      return held(0);
  }
}
