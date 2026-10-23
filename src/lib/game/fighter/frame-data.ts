export const FPS = 60;
export const SUB = 256; // positions are integers in 1/256 px
export const STAGE_WIDTH = 800; // px
export const ROUND_FRAMES = 2700;
export const MAX_HP = 1000;
export const WALK_SPEED = 384; // subpx/frame
export const BACK_SPEED = 320; // subpx/frame
export const JUMP_VY = 3584; // initial upward subpx/frame
export const GRAVITY = 160; // subpx/frame^2
export const START_X_P1 = 250; // px
export const START_X_P2 = 550; // px
export const BODY_HALF_WIDTH = 18; // px
export const GETUP_FRAMES = 45;
export const KNOCKDOWN_FRAMES = 50;
export const KNOCKBACK_SPEED = 2 * SUB; // subpx/frame during hitstun
export const BLOCK_CHIP_DIVISOR = 10;

export type MoveId = 'thrust' | 'sweep' | 'chop' | 'lowSweep';

export type MoveData = {
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitstun: number;
  blockstun: number;
  reachPx: number;
  level: 'high' | 'mid' | 'low';
  knockdown: boolean;
};

export const MOVES: Record<MoveId, MoveData> = {
  thrust: { startup: 9, active: 3, recovery: 14, damage: 60, hitstun: 16, blockstun: 10, reachPx: 150, level: 'mid', knockdown: false },
  sweep: { startup: 14, active: 4, recovery: 18, damage: 90, hitstun: 20, blockstun: 12, reachPx: 130, level: 'mid', knockdown: false },
  chop: { startup: 24, active: 4, recovery: 30, damage: 160, hitstun: 26, blockstun: 16, reachPx: 110, level: 'high', knockdown: true },
  lowSweep: { startup: 16, active: 4, recovery: 20, damage: 80, hitstun: 22, blockstun: 12, reachPx: 125, level: 'low', knockdown: true },
};
