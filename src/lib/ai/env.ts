// What a game has to provide so the generic Q-learning code can train on it.
// The encoded state space must be small and discrete (tabular learning); the game decides what the agent "sees".
export type StepResult<S> = {
  next: S;
  reward: number;
  // True when the episode ends: death, win, or the game's own "stuck" limit. Every episode must eventually end.
  done: boolean;
};

// One agent step: what it saw, what it did, what it got, and what it saw next.
// Independent of the learning algorithm: a table agent applies updateQ to it, a DQN agent pushes it into a replay buffer.
export type Transition<S> = {
  state: S;
  action: number;
  reward: number;
  next: S;
  done: boolean;
};

// Method syntax on purpose: it lets an Env<SomeState> be stored in a registry typed Env<unknown>
export type Env<S> = {
  // Stable id, also the brain file name (public/brains/<id>.json)
  id: string;
  stateCount: number;
  actionCount: number;
  // Bump whenever `encode` changes meaning (new/removed/reordered features) even if stateCount stays the same:
  // a brain trained with another version would silently give wrong actions, so brain loading rejects it.
  featuresVersion: number;
  // `variant` is game-defined (for Snake: the grid size). Omitted -> pick a random one using rng.
  reset(rng: () => number, variant?: number): S;
  // Maps a state to an index in [0, stateCount)
  encode(state: S): number;
  step(state: S, action: number): StepResult<S>;
  // Used for logging and evaluation only
  score(state: S): number;
  // Variants measured after training (e.g. several grid sizes)
  evalVariants: { label: string; variant: number }[];
};
