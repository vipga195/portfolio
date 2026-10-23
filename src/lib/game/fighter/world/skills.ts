import type { WorldMoveId } from './moves.ts';
import { WBIT } from './winputs.ts';

export const MAX_STAMINA = 1000;
export const STAMINA_REGEN = 3; // per frame
export const CMD_LEN = 3; // command tokens remembered
export const CMD_WINDOW = 20; // max age (frames) of the oldest token of a command
export const TOK_CROUCH = 16; // tokens 0..15 are headings

// "toward" = the attack heading (+-1 8-way step), "back" = the opposite heading (+-1 step), "crouch" = a fresh CROUCH press.
export type SkillToken = 'crouch' | 'toward' | 'back';

export type SkillDef = {
  move: WorldMoveId;
  button: number; // WBIT attack bit pressed last
  tokens: readonly SkillToken[]; // must be the last tokens in the buffer, oldest first
  cost: number;
  cooldown: number; // frames
  label: string;
  keys: string;
};

export const SKILL_DEFS: readonly SkillDef[] = [
  { move: 'blink', button: WBIT.ATK_C, tokens: ['back', 'toward'], cost: 400, cooldown: 240, label: 'Blink strike', keys: '←, →, L' },
  { move: 'burst', button: WBIT.ATK_C, tokens: ['crouch', 'crouch'], cost: 450, cooldown: 300, label: 'Burst', keys: 'C, C, L' },
];
export const SKILL_COUNT = SKILL_DEFS.length;

// Circular distance between two headings on the 16-step circle.
function ringDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 16;
  return d > 8 ? 16 - d : d;
}

function tokenMatches(token: number, kind: SkillToken, dir: number): boolean {
  if (kind === 'crouch') return token === TOK_CROUCH;
  if (token < 0 || token >= 16) return false;
  return ringDistance(token, kind === 'toward' ? dir : (dir + 8) % 16) <= 2;
}

// Index of the skill whose command ends the buffer for an attack press on `button` facing `dir`, or -1.
export function matchSkill(cmdTok: readonly number[], cmdAge: readonly number[], button: number, dir: number): number {
  for (let i = 0; i < SKILL_COUNT; i++) {
    const def = SKILL_DEFS[i];
    if ((button & def.button) === 0) continue;
    const n = def.tokens.length;
    let ok = true;
    for (let k = 0; k < n && ok; k++) {
      const slot = CMD_LEN - n + k;
      ok = tokenMatches(cmdTok[slot], def.tokens[k], dir) && cmdAge[slot] <= CMD_WINDOW;
    }
    if (ok) return i;
  }
  return -1;
}
