import { BIT } from "../inputs.ts";
import type { InputMask } from "../inputs.ts";

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

const MOVE_BITS = BIT.LEFT | BIT.RIGHT | BIT.UP | BIT.DOWN;

// The iso view turns world axes 45 degrees on screen (screen right = world +x -y, screen down = world +x +y).
// Rotates the four screen-relative direction bits into world bits; attack bits pass through unchanged.
export function screenToWorldMask(mask: InputMask): InputMask {
  const sx = ((mask & BIT.RIGHT) !== 0 ? 1 : 0) - ((mask & BIT.LEFT) !== 0 ? 1 : 0);
  const sy = ((mask & BIT.DOWN) !== 0 ? 1 : 0) - ((mask & BIT.UP) !== 0 ? 1 : 0);
  const wx = Math.sign(sx + sy);
  const wy = Math.sign(sy - sx);
  let out = mask & ~MOVE_BITS;
  if (wx > 0) out |= BIT.RIGHT;
  if (wx < 0) out |= BIT.LEFT;
  if (wy > 0) out |= BIT.DOWN;
  if (wy < 0) out |= BIT.UP;
  return out;
}
