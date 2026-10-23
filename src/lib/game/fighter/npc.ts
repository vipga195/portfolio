import { nextRandom } from '../../rng.ts';
import { BODY_HALF_WIDTH, MOVES, SUB } from './frame-data.ts';
import type { FightState, Fighter } from './sim.ts';
import { BACK, CHOP, CROUCH, FORWARD, IDLE, LOW_SWEEP, SWEEP, THRUST, actionToMask } from './inputs.ts';
import type { InputMask } from './inputs.ts';

export type NpcLevel = 1 | 2 | 3;
export type NpcState = { level: NpcLevel; seed: number; mask: InputMask; hold: number };

type LevelConfig = {
  interval: number; // frames between decisions
  blockWindow: number; // react to an attack whose active window starts within this many frames
  blockChance: number;
  idleChance: number;
  lowSweepChance: number;
  crouchHighChance: number; // chance to crouch (instead of block) against a high move
  punishes: boolean;
};

const LEVELS: Record<NpcLevel, LevelConfig> = {
  1: { interval: 24, blockWindow: 3, blockChance: 0.3, idleChance: 0.3, lowSweepChance: 0, crouchHighChance: 0, punishes: false },
  2: { interval: 14, blockWindow: 6, blockChance: 0.55, idleChance: 0, lowSweepChance: 0.12, crouchHighChance: 0, punishes: false },
  3: { interval: 8, blockWindow: 10, blockChance: 0.8, idleChance: 0, lowSweepChance: 0.25, crouchHighChance: 0.5, punishes: true },
};

const BLOCK_MARGIN_PX = 10;
const THRUST_REACH = MOVES.thrust.reachPx;
const CHOP_REACH = MOVES.chop.reachPx;

export function createNpc(level: NpcLevel, seed: number): NpcState {
  return { level, seed: seed >>> 0, mask: 0, hold: 0 };
}

function isBusy(f: Fighter): boolean {
  return f.state === 'attack' || f.state === 'blockstun' || f.state === 'hitstun' || f.state === 'knockdown' || f.state === 'getup';
}

// Decides a new mask from the current fight; returns the mask and the advanced seed.
function decide(cfg: LevelConfig, seed: number, me: Fighter, opp: Fighter): [InputMask, number] {
  let s = seed;
  const roll = (): number => {
    const [v, next] = nextRandom(s);
    s = next;
    return v;
  };
  const toward: 1 | -1 = opp.x === me.x ? me.facing : opp.x > me.x ? 1 : -1;
  const dist = Math.abs(opp.x - me.x) / SUB;
  const act = (a: number): [InputMask, number] => [actionToMask(a, toward), s];

  // Defence: an enemy attack is about to become active.
  if (opp.state === 'attack' && opp.move !== null) {
    const data = MOVES[opp.move];
    const untilActive = data.startup - (opp.frame + 1);
    const stillActive = opp.frame + 1 < data.startup + data.active;
    if (stillActive && untilActive <= cfg.blockWindow && dist <= data.reachPx + BODY_HALF_WIDTH + BLOCK_MARGIN_PX) {
      if (roll() < cfg.blockChance) {
        if (data.level === 'high' && roll() < cfg.crouchHighChance) return act(CROUCH);
        const away = actionToMask(BACK, toward);
        return [data.level === 'low' ? away | actionToMask(CROUCH, toward) : away, s];
      }
    }
    // Punish a whiff: the enemy is in the recovery frames of its attack.
    if (cfg.punishes && opp.frame + 1 >= data.startup + data.active) {
      const remaining = data.startup + data.active + data.recovery - (opp.frame + 1);
      if (remaining >= MOVES.chop.startup - 4 && dist <= CHOP_REACH + BODY_HALF_WIDTH) return act(CHOP);
      if (remaining >= MOVES.thrust.startup && dist <= THRUST_REACH + BODY_HALF_WIDTH) return act(THRUST);
    }
  }

  // Spacing.
  if (cfg.idleChance > 0 && roll() < cfg.idleChance) return act(IDLE);
  if (dist > THRUST_REACH) return act(FORWARD);
  if (dist >= CHOP_REACH) {
    const r = roll();
    if (cfg.lowSweepChance > 0 && r < cfg.lowSweepChance) return act(LOW_SWEEP);
    return act(r < 0.75 ? THRUST : SWEEP);
  }
  if (dist < CHOP_REACH - 10) {
    const r = roll();
    if (cfg.lowSweepChance > 0 && r < cfg.lowSweepChance / 2) return act(LOW_SWEEP);
    return act(r < 0.65 ? CHOP : BACK);
  }
  return act(roll() < 0.5 ? THRUST : SWEEP);
}

// Pure: returns this frame's input mask for the fighter at index `side`, and the next NPC state.
export function npcStep(npc: NpcState, fight: FightState, side: 0 | 1): [InputMask, NpcState] {
  const me = fight.fighters[side];
  const opp = fight.fighters[side === 0 ? 1 : 0];

  // Nothing to decide while stunned or attacking; decide afresh as soon as control returns.
  if (isBusy(me)) return [0, { ...npc, mask: 0, hold: 0 }];

  if (npc.hold > 0) return [npc.mask, { ...npc, hold: npc.hold - 1 }];

  const cfg = LEVELS[npc.level];
  const [mask, seed] = decide(cfg, npc.seed, me, opp);
  return [mask, { ...npc, seed, mask, hold: cfg.interval - 1 }];
}
