// Generic tabular Q-learning. Pure functions: runs in Node (training) and in the browser (playing).
export type QTable={
  values: Float64Array;
  stateCount: number;
  actionCount: number;
};

export function createQTable(stateCount: number, actionCount: number): QTable {
  return { values: new Float64Array(stateCount*actionCount), stateCount, actionCount };
}

export function bestValue(table: QTable, state: number): number {
  const base=state*table.actionCount;
  let best=table.values[base];
  for (let a=1; a<table.actionCount; a++) best=Math.max(best, table.values[base+a]);
  return best;
}

// Epsilon-greedy: explore with probability epsilon, otherwise take the best known action (ties broken randomly)
export function chooseAction(table: QTable, state: number, epsilon: number, rng: () => number=Math.random): number {
  if (rng()<epsilon) return Math.floor(rng()*table.actionCount);
  const base=state*table.actionCount;
  const best=bestValue(table, state);
  const ties: number[]=[];
  for (let a=0; a<table.actionCount; a++) {
    if (table.values[base+a]===best) ties.push(a);
  }
  return ties[Math.floor(rng()*ties.length)];
}

// Q(s,a) += alpha * (reward + gamma * max Q(s') - Q(s,a)); a terminal state has no future value
export function updateQ(
  table: QTable,
  state: number,
  action: number,
  reward: number,
  nextState: number,
  done: boolean,
  alpha: number,
  gamma: number,
): void {
  const i=state*table.actionCount+action;
  const target=reward+(done? 0:gamma*bestValue(table, nextState));
  // table.values[i] += alpha * (target - table.values[i]);
  const before=table.values[i];
  table.values[i]+=alpha*(target-table.values[i]);
  if (Math.abs(reward)>=10) {   // only eat (+10) and death (-10), otherwise there are millions of lines
    console.log(`s=${state} a=${action} r=${reward} Q: ${before.toFixed(3)} -> ${table.values[i].toFixed(3)}`);
  }
}
