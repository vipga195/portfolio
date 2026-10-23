// What the Training Lab form may tune. Ranges mirror each algorithm's parseParams (a drift test enforces it),
// but this module imports no algorithm code so it stays small enough for the client bundle.
export type AlgorithmId = "q-learning" | "dqn";

export type ParamField = { key: string; min: number; max: number; step: number; integer: boolean; default: number };

export type AlgorithmUi = {
  // Must equal the algorithm's PUBLIC_MAX_EPISODES
  maxEpisodes: number;
  defaultEpisodes: number;
  fields: ParamField[];
};

export const ALGORITHM_IDS: readonly AlgorithmId[] = ["q-learning", "dqn"];

export const GAME_ID = "snake";

export const ALGORITHM_UI: Record<AlgorithmId, AlgorithmUi> = {
  "q-learning": {
    maxEpisodes: 20_000,
    defaultEpisodes: 2000,
    fields: [
      { key: "alpha", min: 0.01, max: 1, step: 0.01, integer: false, default: 0.1 },
      { key: "gamma", min: 0, max: 1, step: 0.01, integer: false, default: 0.9 },
      { key: "epsilonEnd", min: 0, max: 1, step: 0.01, integer: false, default: 0.02 },
      { key: "exploreFraction", min: 0.05, max: 1, step: 0.05, integer: false, default: 0.6 },
    ],
  },
  dqn: {
    maxEpisodes: 5000,
    defaultEpisodes: 300,
    fields: [
      { key: "lr", min: 0.0001, max: 1, step: 0.0001, integer: false, default: 0.001 },
      { key: "gamma", min: 0, max: 1, step: 0.01, integer: false, default: 0.95 },
      { key: "epsilonEnd", min: 0, max: 1, step: 0.01, integer: false, default: 0.05 },
      { key: "exploreFraction", min: 0.05, max: 1, step: 0.05, integer: false, default: 0.6 },
    ],
  },
};

export function isAlgorithmId(value: string): value is AlgorithmId {
  return ALGORITHM_IDS.some((id) => id === value);
}
