// Reward-shaping profiles and training budgets for the fighter AI. Pure data, shared by the trainer and the brain loader.
export type Archetype = 'aggressive' | 'defensive' | 'combo' | 'weapon';
export type Level = 'easy' | 'normal' | 'hard';

export const ARCHETYPES: readonly Archetype[] = ['aggressive', 'defensive', 'combo', 'weapon'];
export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard'];

// Reward terms per decision step. Damage terms are fractions of MAX_HP (a punch is 0.045, a heavy 0.12).
export type RewardWeights = {
  dealt: number; // per unit of damage dealt
  taken: number; // per unit of damage taken (applied as a penalty)
  win: number; // the opponent died
  lose: number; // the learner died (penalty)
  timeout: number; // episode hit the time cap without a kill (penalty)
  chainHit: number; // per hit landed as the 2nd/3rd link of a chain
  specialHit: number; // per uppercut / spin / dash kick hit
  pickup: number; // per weapon picked up
  weaponHit: number; // per hit landed with a weapon
  approach: number; // per unit of distance closed (fraction of 400 px) while out of kick range
  retreat: number; // per unit of distance opened (fraction of 400 px) while the opponent is in kick range
  step: number; // flat cost per decision (penalty), pushes toward finishing the fight
};

export const REWARD_WEIGHTS: Record<Archetype, RewardWeights> = {
  // Rush in and trade: damage dealt counts double, damage taken is cheap, closing distance is rewarded.
  aggressive: { dealt: 4, taken: 1.5, win: 1, lose: 0.5, timeout: 0.5, chainHit: 0, specialHit: 0, pickup: 0, weaponHit: 0, approach: 0.3, retreat: 0, step: 0.01 },
  // Counter-fighter: getting hit is expensive, opening distance when pressured is fine, little time pressure.
  defensive: { dealt: 2, taken: 4, win: 1, lose: 1.5, timeout: 0.1, chainHit: 0, specialHit: 0, pickup: 0, weaponHit: 0, approach: 0, retreat: 0.2, step: 0.002 },
  // Bonus for chained hits and special moves (uppercut, spin, dash kick).
  combo: { dealt: 2.5, taken: 2, win: 1, lose: 1, timeout: 0.3, chainHit: 0.5, specialHit: 0.4, pickup: 0, weaponHit: 0, approach: 0.15, retreat: 0, step: 0.005 },
  // Bonus for picking up and landing weapon hits.
  weapon: { dealt: 2.5, taken: 2, win: 1, lose: 1, timeout: 0.3, chainHit: 0, specialHit: 0, pickup: 0.3, weaponHit: 0.4, approach: 0.15, retreat: 0, step: 0.005 },
};

// Total training episodes at which a checkpoint is saved as that level. One run per archetype produces all three
// files, so "hard" is the same network after more training than "normal", and "normal" more than "easy".
export const LEVEL_EPISODES: Record<Level, number> = { easy: 400, normal: 1500, hard: 4000 };

// Exploration noise (probability of a random action per decision) a player may add at play time.
export const LEVEL_EPSILON: Record<Level, number> = { easy: 0.15, normal: 0.05, hard: 0 };
