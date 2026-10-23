export const BIT = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, THRUST: 16, SWEEP: 32, CHOP: 64 } as const;
export type InputMask = number;

export function has(mask: InputMask, bit: number): boolean {
  return (mask & bit) !== 0;
}

export const ACTION_COUNT = 9;
export const IDLE = 0;
export const FORWARD = 1;
export const BACK = 2;
export const JUMP = 3;
export const CROUCH = 4;
export const THRUST = 5;
export const SWEEP = 6;
export const CHOP = 7;
export const LOW_SWEEP = 8;

export function actionToMask(action: number, facing: 1 | -1): InputMask {
  switch (action) {
    case IDLE:
      return 0;
    case FORWARD:
      return facing === 1 ? BIT.RIGHT : BIT.LEFT;
    case BACK:
      return facing === 1 ? BIT.LEFT : BIT.RIGHT;
    case JUMP:
      return BIT.UP;
    case CROUCH:
      return BIT.DOWN;
    case THRUST:
      return BIT.THRUST;
    case SWEEP:
      return BIT.SWEEP;
    case CHOP:
      return BIT.CHOP;
    case LOW_SWEEP:
      return BIT.DOWN | BIT.SWEEP;
    default:
      return 0;
  }
}

export function encodeInputs(frames: InputMask[]): number[] {
  if (frames.length === 0) return [];
  const encoded: number[] = [];
  let currentMask = frames[0];
  let runLength = 1;

  for (let i = 1; i < frames.length; i++) {
    if (frames[i] === currentMask) {
      runLength++;
    } else {
      encoded.push(currentMask, runLength);
      currentMask = frames[i];
      runLength = 1;
    }
  }
  encoded.push(currentMask, runLength);
  return encoded;
}

export function decodeInputs(rle: number[]): InputMask[] | null {
  if (rle.length % 2 !== 0) return null;
  const decoded: InputMask[] = [];

  for (let i = 0; i < rle.length; i += 2) {
    const mask = rle[i];
    const runLength = rle[i + 1];

    if (!Number.isInteger(mask) || mask < 0 || mask > 127 || !Number.isInteger(runLength) || runLength < 1) return null;

    for (let j = 0; j < runLength; j++) {
      decoded.push(mask);
    }
  }

  return decoded;
}
