// Trains DQN fighter brains (one run per archetype, checkpoints saved as easy/normal/hard) headlessly.
// Usage: node scripts/train-fighter.ts [--archetype aggressive|defensive|combo|weapon|all] [--level easy|normal|hard|all]
//          [--episodes N] [--out dir] [--seed S] [--eval] [--eval-only] [--matches M]
//   --episodes N  total episodes of the run (the "hard" budget); easy/normal checkpoints scale proportionally
//   --eval        after training, play each saved brain vs the level-1 scripted NPC and print a win-rate table
//   --eval-only   skip training and evaluate the brain files already in --out
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_DQN_OPTIONS, toDqnBrain, trainDqn } from '../src/lib/ai/dqn.ts';
import type { DqnOptions } from '../src/lib/ai/dqn.ts';
import { cloneMlp } from '../src/lib/ai/nn.ts';
import { createMlp } from '../src/lib/ai/nn.ts';
import { seededRng } from '../src/lib/rng.ts';
import { ACTIONS_VERSION, DECISION_FRAMES } from '../src/lib/game/fighter/world/actions.ts';
import { ARCHETYPES, LEVELS, LEVEL_EPISODES } from '../src/lib/game/fighter/world/archetypes.ts';
import type { Archetype, Level } from '../src/lib/game/fighter/world/archetypes.ts';
import { FIGHTER_BRAIN_SHAPE, parseFighterBrain } from '../src/lib/game/fighter/world/npc-brain.ts';
import type { FighterBrain, FighterBrainFile } from '../src/lib/game/fighter/world/npc-brain.ts';
import { createTrainEnv, evaluateBrain, scriptedOpponent } from '../src/lib/game/fighter/world/train-env.ts';
import type { MatchResult } from '../src/lib/game/fighter/world/train-env.ts';

const HIDDEN = [48, 48];
const EVAL_SEED = 424242;

const FIGHTER_DQN: DqnOptions = {
  ...DEFAULT_DQN_OPTIONS,
  hidden: HIDDEN,
  gamma: 0.97,
  exploreFraction: 0.5,
  reportEvery: 100,
};

function usage(message: string): never {
  console.error(`${message}\nUsage: node scripts/train-fighter.ts [--archetype <a|all>] [--level <l|all>] [--episodes N] [--out dir] [--seed S] [--eval] [--eval-only] [--matches M]`);
  process.exit(1);
}

function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith('--')) usage(`${name} needs a value`);
  return value;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function pick<T extends string>(raw: string | undefined, all: readonly T[], label: string): readonly T[] {
  if (raw === undefined || raw === 'all') return all;
  const found = all.find((v) => v === raw);
  if (found === undefined) usage(`unknown ${label} "${raw}"`);
  return [found];
}

function brainPath(dir: string, archetype: Archetype, level: Level): string {
  return join(dir, `fighter-${archetype}-${level}.json`);
}

function trainArchetype(archetype: Archetype, levels: readonly Level[], total: number, dir: string, seed: number): void {
  const scale = total / LEVEL_EPISODES.hard;
  const checkpoints = LEVELS.map((level) => ({ level, episodes: Math.max(1, Math.round(LEVEL_EPISODES[level] * scale)) }));
  const last = checkpoints[checkpoints.length - 1].episodes;
  const reportEvery = checkpoints.map((c) => c.episodes).reduce(gcd, 0);
  const rng = seededRng(seed);
  const env = createTrainEnv(archetype, scriptedOpponent);
  const net = createMlp([env.observationSize, ...HIDDEN, env.actionCount], rng);
  const startedAt = Date.now();
  mkdirSync(dir, { recursive: true });

  trainDqn(
    env,
    {
      ...FIGHTER_DQN,
      episodes: last,
      reportEvery,
      onProgress: ({ episode, epsilon, avg, loss }) => {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`[${archetype}] episode ${episode}/${last}  eps=${epsilon.toFixed(2)}  hpDiff=${avg.toFixed(3)}  loss=${loss.toFixed(4)}  ${seconds}s`);
        for (const c of checkpoints) {
          if (c.episodes !== episode || !levels.includes(c.level)) continue;
          const file: FighterBrainFile = {
            ...toDqnBrain(FIGHTER_BRAIN_SHAPE, cloneMlp(net), episode),
            archetype,
            level: c.level,
            actionsVersion: ACTIONS_VERSION,
            decisionFrames: DECISION_FRAMES,
          };
          writeFileSync(brainPath(dir, archetype, c.level), JSON.stringify(file));
          console.log(`saved ${brainPath(dir, archetype, c.level)}`);
        }
      },
    },
    rng,
    net,
  );
}

function loadBrain(path: string): FighterBrain | null {
  if (!existsSync(path)) return null;
  try {
    return parseFighterBrain(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null; // corrupt file: reported as missing
  }
}

function evaluateAll(archetypes: readonly Archetype[], levels: readonly Level[], dir: string, matches: number): void {
  const pct = (n: number): string => `${((100 * n) / matches).toFixed(0)}%`;
  console.log(`\nvs level-1 scripted NPC, ${matches} seeded matches each (win = kill or hp lead at the 20 s cap)`);
  console.log('archetype    level   win   loss  draw  kills  avgHpDiff');
  for (const archetype of archetypes) {
    for (const level of levels) {
      const brain = loadBrain(brainPath(dir, archetype, level));
      if (brain === null) {
        console.log(`${archetype.padEnd(12)} ${level.padEnd(7)} (no valid brain file)`);
        continue;
      }
      const r: MatchResult = evaluateBrain(brain, scriptedOpponent, matches, EVAL_SEED);
      console.log(
        `${archetype.padEnd(12)} ${level.padEnd(7)} ${pct(r.wins).padEnd(5)} ${pct(r.losses).padEnd(5)} ${pct(r.draws).padEnd(5)} ${String(r.kills).padEnd(6)} ${r.avgHpDiff.toFixed(3)}`,
      );
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const archetypes = pick(flagValue(args, '--archetype'), ARCHETYPES, 'archetype');
  const levels = pick(flagValue(args, '--level'), LEVELS, 'level');
  const dir = flagValue(args, '--out') ?? 'public/brains';
  const total = Number(flagValue(args, '--episodes') ?? LEVEL_EPISODES.hard);
  const seed = Number(flagValue(args, '--seed') ?? 1);
  const matches = Number(flagValue(args, '--matches') ?? 50);
  if (!Number.isInteger(total) || total < 1) usage('--episodes must be a positive integer');
  if (!Number.isInteger(seed) || !Number.isInteger(matches) || matches < 1) usage('--seed and --matches must be integers');

  if (!args.includes('--eval-only')) {
    for (const archetype of archetypes) trainArchetype(archetype, levels, total, dir, seed + ARCHETYPES.indexOf(archetype) * 1000);
  }
  if (args.includes('--eval') || args.includes('--eval-only')) evaluateAll(archetypes, levels, dir, matches);
}

main();
