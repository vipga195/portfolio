// World input bits. The direction and first three attack bits equal the Duel BIT values (ATK_A = THRUST, ...);
// RUN, CROUCH and PICKUP are world-only, so world masks can exceed the Duel 127 cap.
export const WBIT = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  ATK_A: 16,
  ATK_B: 32,
  ATK_C: 64,
  RUN: 128,
  CROUCH: 256,
  PICKUP: 512,
} as const;
