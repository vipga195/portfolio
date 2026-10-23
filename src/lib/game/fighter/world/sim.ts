import { nextRandom } from '../../../rng.ts';
import { BODY_HALF_WIDTH, MAX_HP, MOVES, SUB, WALK_SPEED } from '../frame-data.ts';
import { BIT, has } from '../inputs.ts';
import type { InputMask } from '../inputs.ts';
import { DIR_COS, DIR_COUNT, DIR_SIN, dirFromVector } from './dirs.ts';
import { createWorldNpc, npcStepWorld } from './npc.ts';

export type WorldMoveId = 'thrust' | 'sweep' | 'chop';
export type ActorStateName = 'idle' | 'walk' | 'attack' | 'hitstun' | 'dead';

export type Actor = {
  x: number; // subpx
  y: number; // subpx
  dir: number; // 0..15
  hp: number;
  state: ActorStateName;
  frame: number; // frames spent in the current attack, stun or dead state
  move: WorldMoveId | null;
  hitDone: boolean;
  stun: number; // total duration of the current hitstun
  invuln: number; // frames of invulnerability left
};

export type WorldState = {
  tick: number;
  rng: number;
  player: Actor;
  general: Actor;
};

export const WORLD_WIDTH = 1600; // px
export const WORLD_HEIGHT = 1200; // px
export const RESPAWN_FRAMES = 120;
export const INVULN_FRAMES = 60;

// Half-width of each move's fan, in 22.5 degree direction steps either side of the facing.
export const ARC_STEPS: Record<WorldMoveId, number> = { thrust: 1, sweep: 3, chop: 2 };

const MIN_X = BODY_HALF_WIDTH * SUB;
const MAX_X = (WORLD_WIDTH - BODY_HALF_WIDTH) * SUB;
const MIN_Y = BODY_HALF_WIDTH * SUB;
const MAX_Y = (WORLD_HEIGHT - BODY_HALF_WIDTH) * SUB;
const START_PLAYER = { x: 700 * SUB, y: 600 * SUB, dir: 0 };
const START_GENERAL = { x: 900 * SUB, y: 600 * SUB, dir: 8 };
const NPC_SEED_XOR = 0x9e3779b9;

const STATE_INDEX: Record<ActorStateName, number> = { idle: 0, walk: 1, attack: 2, hitstun: 3, dead: 4 };
const MOVE_INDEX: Record<WorldMoveId, number> = { thrust: 0, sweep: 1, chop: 2 };

function makeActor(start: { x: number; y: number; dir: number }): Actor {
  return {
    ...start,
    hp: MAX_HP,
    state: 'idle',
    frame: 0,
    move: null,
    hitDone: false,
    stun: 0,
    invuln: 0,
  };
}

export function createWorld(seed: number): WorldState {
  return { tick: 0, rng: seed >>> 0, player: makeActor(START_PLAYER), general: makeActor(START_GENERAL) };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function toIdle(a: Actor): void {
  a.state = 'idle';
  a.frame = 0;
  a.move = null;
  a.hitDone = false;
  a.stun = 0;
}

function advanceTimers(a: Actor): void {
  if (a.invuln > 0) a.invuln -= 1;
  switch (a.state) {
    case 'attack': {
      if (a.move === null) {
        toIdle(a);
        return;
      }
      const { startup, active, recovery } = MOVES[a.move];
      a.frame += 1;
      if (a.frame >= startup + active + recovery) toIdle(a);
      return;
    }
    case 'hitstun':
      a.frame += 1;
      if (a.frame >= a.stun) toIdle(a);
      return;
    case 'dead':
      a.frame += 1;
      if (a.frame >= RESPAWN_FRAMES) {
        toIdle(a);
        a.hp = MAX_HP;
        a.invuln = INVULN_FRAMES;
      }
      return;
    default:
      return;
  }
}

function pickAttack(mask: InputMask): WorldMoveId | null {
  if (has(mask, BIT.THRUST)) return 'thrust';
  if (has(mask, BIT.SWEEP)) return 'sweep';
  if (has(mask, BIT.CHOP)) return 'chop';
  return null;
}

// Step (a): turn the input into a facing change, movement or an attack start.
function applyIntent(a: Actor, mask: InputMask): void {
  if (a.state !== 'idle' && a.state !== 'walk') return;
  const dx = (has(mask, BIT.RIGHT) ? 1 : 0) - (has(mask, BIT.LEFT) ? 1 : 0);
  const dy = (has(mask, BIT.DOWN) ? 1 : 0) - (has(mask, BIT.UP) ? 1 : 0);
  const heading = dirFromVector(dx as -1 | 0 | 1, dy as -1 | 0 | 1);
  if (heading >= 0) a.dir = heading;

  const move = pickAttack(mask);
  if (move !== null) {
    a.state = 'attack';
    a.move = move;
    a.frame = 0;
    a.hitDone = false;
    return;
  }
  if (heading < 0) {
    a.state = 'idle';
    return;
  }
  a.state = 'walk';
  a.x = clamp(a.x + Math.trunc((WALK_SPEED * DIR_COS[a.dir]) / 256), MIN_X, MAX_X);
  a.y = clamp(a.y + Math.trunc((WALK_SPEED * DIR_SIN[a.dir]) / 256), MIN_Y, MAX_Y);
}

// Step (c): does the attacker's active move reach the defender? Fan = in range and within the arc of the facing.
function connects(att: Actor, def: Actor): boolean {
  if (att.state !== 'attack' || att.move === null || att.hitDone) return false;
  const data = MOVES[att.move];
  if (att.frame < data.startup || att.frame >= data.startup + data.active) return false;
  if (def.state === 'dead' || def.invuln > 0) return false;

  const dx = def.x - att.x;
  const dy = def.y - att.y;
  const reach = (data.reachPx + BODY_HALF_WIDTH) * SUB;
  const d2 = dx * dx + dy * dy;
  if (d2 > reach * reach) return false;
  if (d2 === 0) return true;
  // dot is the target vector projected on the facing, scaled by 256; the arc test is dot >= |d| * cos(arc).
  const dot = dx * DIR_COS[att.dir] + dy * DIR_SIN[att.dir];
  if (dot <= 0) return false;
  const cosArc = DIR_COS[ARC_STEPS[att.move]];
  return dot * dot >= d2 * cosArc * cosArc;
}

function applyHit(att: Actor, def: Actor): void {
  if (att.move === null) return;
  const data = MOVES[att.move];
  def.hp -= data.damage;
  def.move = null;
  def.hitDone = false;
  def.frame = 0;
  if (def.hp <= 0) {
    def.hp = 0;
    def.state = 'dead';
    def.stun = 0;
    return;
  }
  def.state = 'hitstun';
  def.stun = data.hitstun;
}

export function stepWorld(state: WorldState, inputs: [InputMask, InputMask]): WorldState {
  const player = { ...state.player };
  const general = { ...state.general };

  advanceTimers(player);
  advanceTimers(general);
  applyIntent(player, inputs[0]);
  applyIntent(general, inputs[1]);

  // Hits are evaluated against the state at the start of the hit phase, so trades resolve together.
  const snapP = { ...player };
  const snapG = { ...general };
  const hitG = connects(snapP, snapG);
  const hitP = connects(snapG, snapP);
  if (hitG) applyHit(snapP, general);
  if (hitP) applyHit(snapG, player);
  if (hitG && player.state === 'attack') player.hitDone = true;
  if (hitP && general.state === 'attack') general.hitDone = true;

  return { tick: state.tick + 1, rng: nextRandom(state.rng)[1], player, general };
}

function mix(hash: number, value: number): number {
  let h = hash;
  const v = value | 0;
  for (let shift = 0; shift < 32; shift += 8) {
    h = Math.imul(h ^ ((v >>> shift) & 0xff), 16777619);
  }
  return h;
}

// 32-bit FNV-1a over every integer field of the state.
export function hashWorld(state: WorldState): number {
  let h = 0x811c9dc5;
  h = mix(h, state.tick);
  h = mix(h, state.rng);
  for (const a of [state.player, state.general]) {
    h = mix(h, a.x);
    h = mix(h, a.y);
    h = mix(h, a.dir % DIR_COUNT);
    h = mix(h, a.hp);
    h = mix(h, STATE_INDEX[a.state]);
    h = mix(h, a.frame);
    h = mix(h, a.move === null ? -1 : MOVE_INDEX[a.move]);
    h = mix(h, a.hitDone ? 1 : 0);
    h = mix(h, a.stun);
    h = mix(h, a.invuln);
  }
  return h >>> 0;
}

// Runs one frame per player input; the general is driven by the level-1 NPC.
export function simulateWorld(seed: number, playerInputs: InputMask[]): WorldState {
  let state = createWorld(seed);
  let npc = createWorldNpc((seed ^ NPC_SEED_XOR) >>> 0);
  for (const mask of playerInputs) {
    const [npcMask, nextNpc] = npcStepWorld(npc, state);
    npc = nextNpc;
    state = stepWorld(state, [mask, npcMask]);
  }
  return state;
}

