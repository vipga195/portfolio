import type { InputMask } from "../inputs.ts";
import { WBIT } from "./winputs.ts";

// 16 facing directions, 22.5 degrees apart. 0 = east (+x), 4 = south (+y, screen down), 8 = west, 12 = north.
// Unit vectors scaled by 256, pasted as literals so the sim never calls Math.cos/Math.sin.
export const DIR_COUNT = 16;
export const DIR_COS = [256, 237, 181, 98, 0, -98, -181, -237, -256, -237, -181, -98, 0, 98, 181, 237] as const;
export const DIR_SIN = [0, 98, 181, 237, 256, 237, 181, 98, 0, -98, -181, -237, -256, -237, -181, -98] as const;

// 8-way direction by ((dx + 1) * 3 + (dy + 1)) with dx, dy in {-1, 0, 1}; -1 = no direction.
const EIGHT_WAY = [10, 8, 6, 12, -1, 4, 14, 0, 2] as const;

export function dirFromVector(dx: -1 | 0 | 1, dy: -1 | 0 | 1): number {
  return EIGHT_WAY[(dx + 1) * 3 + (dy + 1)];
}

const MOVE_BITS = WBIT.LEFT | WBIT.RIGHT | WBIT.UP | WBIT.DOWN;

// The iso view turns world axes 45 degrees on screen (screen right = world +x -y, screen down = world +x +y).
// Rotates the four screen-relative direction bits into world bits; attack bits pass through unchanged.
export function screenToWorldMask(mask: InputMask): InputMask {
  const sx = ((mask & WBIT.RIGHT) !== 0 ? 1 : 0) - ((mask & WBIT.LEFT) !== 0 ? 1 : 0);
  const sy = ((mask & WBIT.DOWN) !== 0 ? 1 : 0) - ((mask & WBIT.UP) !== 0 ? 1 : 0);
  const wx = Math.sign(sx + sy);
  const wy = Math.sign(sy - sx);
  let out = mask & ~MOVE_BITS;
  if (wx > 0) out |= WBIT.RIGHT;
  if (wx < 0) out |= WBIT.LEFT;
  if (wy > 0) out |= WBIT.DOWN;
  if (wy < 0) out |= WBIT.UP;
  return out;
}
