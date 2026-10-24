import type { Game } from "../../../ai/game.ts";
import { createTrainEnv } from "./train-env.ts";
import type { TrainState } from "./train-env.ts";
import { ACTION_COUNT } from "./actions.ts";
import { ARCHETYPES } from "./archetypes.ts";
import type { Archetype } from "./archetypes.ts";
import { FEATURE_COUNT, FEATURES_VERSION } from "./features.ts";

export function fighterGameId(archetype: Archetype): string {
  return `fighter-${archetype}`;
}

const fighterEnvs = ARCHETYPES.map((archetype) => ({ archetype, env: createTrainEnv(archetype) }));

export const fighterGames: Game<TrainState>[] = fighterEnvs.map(({ archetype, env }) => ({
  id: fighterGameId(archetype),
  actionCount: ACTION_COUNT,
  reset: (rng, variant) => env.reset(rng, variant),
  step: (state, action) => env.step(state, action),
  score: (state) => env.score(state),
  evalVariants: [{ label: "vs scripted NPC", variant: 0 }],
  dense: {
    observationSize: FEATURE_COUNT,
    featuresVersion: FEATURES_VERSION,
    observe: (state) => env.observe(state),
  },
}));
