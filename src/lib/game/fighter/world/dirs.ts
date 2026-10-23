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
