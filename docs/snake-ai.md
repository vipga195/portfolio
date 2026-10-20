# Snake AI

Two agents learn Snake by reinforcement learning, both in pure TypeScript with no ML dependency. Only the Q-table agent is wired into the UI (`/games/snake`).

## Agents

| | Q-learning (in the UI) | DQN (experimental, not in the UI) |
|---|---|---|
| Model | Table, 2048 states x 3 actions | MLP 59 -> 64 -> 64 -> 3, manual backprop + Adam |
| Input | 11 hand-built bits (3 flood-fill "cramped", 4 heading, 4 food side) | 7x7 egocentric window (49), food offset (2), food side (4), snake length (1), 3 cramped bits |
| Code | `src/lib/ai/qlearning.ts`, `train.ts`, `brain.ts` | `src/lib/ai/nn.ts`, `dqn.ts`, `src/lib/game/snake-dqn.ts` |
| Train | `npm run train` -> `public/brains/snake.json` | `npm run train:dqn [episodes] [outFile]` (default `public/brains/snake-dqn.json`) |

Both train scripts accept `--resume` (e.g. `node scripts/train.ts snake 20000 --resume`): it loads the existing brain from the output file and continues with epsilon starting at 0.2 instead of 1. It fails if the file is missing or was trained with another `featuresVersion`. For DQN only the weights are saved, so the replay buffer and Adam state restart empty.

Both share the reward (+10 eat, -10 die or stuck, +/-0.1 closer/farther) and the Env adapter in `src/lib/game/snake-env.ts`. Actions are relative to the heading (forward, left, right).

## What was tried (DQN, greedy eval, 100 games per grid, average score)

| Run | 8 | 12 | 20 | 30 | 40 |
|---|---|---|---|---|---|
| Q-table (baseline) | ~20 | ~39 | ~77 | ~108 | ~128 |
| 1. Raw window, 6k episodes (gamma 0.95, lr 1e-3) | 20.9 | 29.4 | 40.3 | 50.1 | 60.0 |
| 2. Tuned, 20k episodes (gamma 0.99, replay 200k, 9x9 window, explore 0.85, lr 5e-4) | 16.9 | 24.7 | 38.2 | 47.7 | 10.4 |
| 3. Run 1 settings + 3 flood-fill bits, 10k episodes | 24.3 | 42.1 | 73.0 | 98.0 | 116.1 |

Findings:
- Raw observation (no flood-fill) plateaus around a training average of 16 and is about half the Q-table on large grids: a 7x7 window cannot see dead-end pockets.
- Run 2 changed five settings at once and got worse (loss spiked to ~5.7 near epsilon 0.05; likely unstable bootstrapping with gamma 0.99). Which setting hurt is unknown.
- Adding the Q-table's flood-fill bits (run 3) roughly doubles large-grid scores. The DQN then beats the Q-table on 8x8 and 12x12 and trails it by about 4% (20), 10% (30) and 9% (40).
- Run 3 therefore uses a hand-built feature and is not a "raw input" result.

## Caveats

- One seed per run, 100 games per cell: differences of a few points on small grids are noise. Best-of-100 is a noisy statistic.
- Training uses grids 8..20 only; evaluation covers 8..40.
- Nothing beyond 20k episodes was tried, and the trained DQN weights are not committed.

## Open work

- Wire a DQN brain into `SnakeGame.tsx` only if it clearly beats the Q-table (needs multiple seeds and fixed eval seeds).
- Change one hyperparameter at a time from the run 1 baseline; try less frequent target sync (~2000 steps), reward/gradient clipping, and training on grids up to 40.
- Pre-existing, unrelated review notes: `SnakeGame.tsx` moves with the default heading while the brain is loading; `Makefile` lacks `.PHONY: test`.

See also: [training platform](training-platform.md) (job queue and trainer worker).
