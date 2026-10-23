// Generic Double DQN on top of nn.ts. Pure functions: trains in Node, plays in the browser.
import type { Env } from "./env.ts";
import { cloneMlp, copyMlp, createAdam, createMlp, forward, parseMlp, serializeMlp, trainBatch } from "./nn.ts";
import type { Mlp, SerializedMlp } from "./nn.ts";

// An Env without the tabular bits: the agent sees a dense float vector instead of a state index
export type DenseEnv<S>=Omit<Env<S>, "stateCount" | "encode"> & {
  observationSize: number;
  observe(state: S): Float32Array;
};

export type DqnOptions={
  episodes: number;
  hidden: number[];
  lr: number;
  gamma: number;
  batchSize: number;
  replaySize: number;
  // Environment steps before learning starts
  warmupSteps: number;
  learnEvery: number;
  targetSyncEvery: number;
  epsilonStart: number;
  epsilonEnd: number;
  // Epsilon falls linearly during this fraction of the episodes, then stays at epsilonEnd
  exploreFraction: number;
  reportEvery: number;
  onProgress?: (info: { episode: number; epsilon: number; avg: number; best: number; loss: number }) => void;
};

export const DEFAULT_DQN_OPTIONS: DqnOptions={
  episodes: 20000,
  hidden: [64, 64],
  lr: 1e-3,
  gamma: 0.95,
  batchSize: 64,
  replaySize: 50_000,
  warmupSteps: 1_000,
  learnEvery: 4,
  targetSyncEvery: 500,
  epsilonStart: 1,
  epsilonEnd: 0.05,
  exploreFraction: 0.6,
  reportEvery: 1000,
};

export function epsilonAt(episode: number, options: DqnOptions): number {
  const progress=Math.min(1, episode/(options.episodes*options.exploreFraction));
  return options.epsilonStart+(options.epsilonEnd-options.epsilonStart)*progress;
}

export type Replay={
  capacity: number;
  obsSize: number;
  obs: Float32Array;
  nextObs: Float32Array;
  actions: Int32Array;
  rewards: Float32Array;
  dones: Uint8Array;
  // Next slot to write, and how many slots hold data
  cursor: number;
  size: number;
};

export function createReplay(capacity: number, obsSize: number): Replay {
  return {
    capacity,
    obsSize,
    obs: new Float32Array(capacity*obsSize),
    nextObs: new Float32Array(capacity*obsSize),
    actions: new Int32Array(capacity),
    rewards: new Float32Array(capacity),
    dones: new Uint8Array(capacity),
    cursor: 0,
    size: 0,
  };
}

// Ring buffer: once full, the oldest transition is overwritten
export function pushReplay(r: Replay, obs: Float32Array, action: number, reward: number, nextObs: Float32Array, done: boolean): void {
  r.obs.set(obs, r.cursor*r.obsSize);
  r.nextObs.set(nextObs, r.cursor*r.obsSize);
  r.actions[r.cursor]=action;
  r.rewards[r.cursor]=reward;
  r.dones[r.cursor]=done ? 1 : 0;
  r.cursor=(r.cursor+1)%r.capacity;
  r.size=Math.min(r.size+1, r.capacity);
}

function view(buffer: Float32Array, index: number, size: number): Float32Array {
  return buffer.subarray(index*size, (index+1)*size);
}

export function argmax(values: ArrayLike<number>): number {
  let best=0;
  for (let i=1; i<values.length; i++) if (values[i]>values[best]) best=i;
  return best;
}

function chooseAction(net: Mlp, obs: Float32Array, actionCount: number, epsilon: number, rng: () => number): number {
  if (rng()<epsilon) return Math.floor(rng()*actionCount);
  return argmax(forward(net, obs));
}

// Double DQN: the online net picks the next action, the target net evaluates it
function learn(online: Mlp, target: Mlp, adam: ReturnType<typeof createAdam>, replay: Replay, options: DqnOptions, actionCount: number, rng: () => number): number {
  const inputs: Float32Array[]=[];
  const targets: Float32Array[]=[];
  const masks: Float32Array[]=[];
  for (let n=0; n<options.batchSize; n++) {
    const i=Math.floor(rng()*replay.size);
    let y=replay.rewards[i];
    if (!replay.dones[i]) {
      const next=view(replay.nextObs, i, replay.obsSize);
      y+=options.gamma*forward(target, next)[argmax(forward(online, next))];
    }
    const t=new Float32Array(actionCount);
    const m=new Float32Array(actionCount);
    t[replay.actions[i]]=y;
    m[replay.actions[i]]=1;
    inputs.push(view(replay.obs, i, replay.obsSize));
    targets.push(t);
    masks.push(m);
  }
  return trainBatch(online, adam, inputs, targets, masks, options.lr);
}

export function trainDqn<S>(env: DenseEnv<S>, options: DqnOptions, rng: () => number=Math.random, initial?: Mlp): Mlp {
  // Resume from previously trained weights when given (the replay buffer and Adam state always start empty)
  const online=initial ?? createMlp([env.observationSize, ...options.hidden, env.actionCount], rng);
  const target=cloneMlp(online);
  const adam=createAdam(online);
  const replay=createReplay(options.replaySize, env.observationSize);
  let steps=0;
  let total=0;
  let best=0;
  let lossSum=0;
  let lossCount=0;

  for (let episode=1; episode<=options.episodes; episode++) {
    const epsilon=epsilonAt(episode, options);
    let state=env.reset(rng);
    let obs=env.observe(state);
    for (;;) {
      const action=chooseAction(online, obs, env.actionCount, epsilon, rng);
      const { next, reward, done }=env.step(state, action);
      const nextObs=env.observe(next);
      pushReplay(replay, obs, action, reward, nextObs, done);
      steps++;
      if (steps>=options.warmupSteps&&replay.size>=options.batchSize&&steps%options.learnEvery===0) {
        lossSum+=learn(online, target, adam, replay, options, env.actionCount, rng);
        lossCount++;
      }
      if (steps%options.targetSyncEvery===0) copyMlp(online, target);
      state=next;
      obs=nextObs;
      if (done) break;
    }
    const score=env.score(state);
    total+=score;
    best=Math.max(best, score);
    if (episode%options.reportEvery===0) {
      options.onProgress?.({ episode, epsilon, avg: total/options.reportEvery, best, loss: lossCount>0 ? lossSum/lossCount : 0 });
      total=0;
      best=0;
      lossSum=0;
      lossCount=0;
    }
  }
  return online;
}

// Greedy games (no exploration, no learning)
export function evaluateDqn<S>(env: DenseEnv<S>, net: Mlp, variant: number, games: number, rng: () => number=Math.random): { avg: number; best: number } {
  let total=0;
  let best=0;
  for (let g=0; g<games; g++) {
    let state=env.reset(rng, variant);
    for (;;) {
      const { next, done }=env.step(state, argmax(forward(net, env.observe(state))));
      state=next;
      if (done) break;
    }
    const score=env.score(state);
    total+=score;
    best=Math.max(best, score);
  }
  return { avg: total/games, best };
}

export const DQN_BRAIN_VERSION=1;

export type DqnBrain={
  game: string;
  // File format version of the brain JSON itself
  version: number;
  // Version of the game's observation layout (DenseEnv.featuresVersion) the network was trained with
  featuresVersion: number;
  observationSize: number;
  actionCount: number;
  episodes: number;
  net: SerializedMlp;
};

// DenseEnv satisfies this
export type DqnBrainShape={ id: string; observationSize: number; actionCount: number; featuresVersion: number };

export function toDqnBrain(shape: DqnBrainShape, net: Mlp, episodes: number): DqnBrain {
  return {
    game: shape.id,
    version: DQN_BRAIN_VERSION,
    featuresVersion: shape.featuresVersion,
    observationSize: shape.observationSize,
    actionCount: shape.actionCount,
    episodes,
    net: serializeMlp(net),
  };
}

// A brain file is loaded over the network, so validate it against the game that wants to use it
export function parseDqnBrain(input: unknown, shape: DqnBrainShape): Mlp | null {
  if (typeof input!=="object"||input===null) return null;
  const { game, version, featuresVersion, observationSize, actionCount, net }=input as Partial<Record<keyof DqnBrain, unknown>>;   // fields checked one by one below
  if (game!==shape.id||version!==DQN_BRAIN_VERSION) return null;
  if (featuresVersion!==shape.featuresVersion) return null;
  if (observationSize!==shape.observationSize||actionCount!==shape.actionCount) return null;
  const mlp=parseMlp(net);
  if (!mlp) return null;
  if (mlp.sizes[0]!==shape.observationSize||mlp.sizes[mlp.sizes.length-1]!==shape.actionCount) return null;
  return mlp;
}
