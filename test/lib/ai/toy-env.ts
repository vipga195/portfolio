// A tiny game for testing the generic learning code: walk on a line of 5 cells starting in the middle.
// Action 1 = right, action 0 = left. Reaching cell 4 wins (+1), reaching cell 0 or taking too long loses (-1).
import type { Env } from "../../../src/lib/ai/env.ts";
import { createQTable } from "../../../src/lib/ai/qlearning.ts";
import type { QTable } from "../../../src/lib/ai/qlearning.ts";

export type LineState = { pos: number; steps: number };

export const lineEnv: Env<LineState> = {
  id: "line",
  stateCount: 5,
  actionCount: 2,
  featuresVersion: 1,
  reset: () => ({ pos: 2, steps: 0 }),
  encode: (s) => s.pos,
  step(s, action) {
    const pos = s.pos + (action === 1 ? 1 : -1);
    const steps = s.steps + 1;
    const won = pos === 4;
    const lost = pos === 0 || steps > 20;
    return { next: { pos, steps }, reward: won ? 1 : lost ? -1 : 0, done: won || lost };
  },
  score: (s) => (s.pos === 4 ? 1 : 0),
  evalVariants: [{ label: "line", variant: 0 }],
};

// A table that always prefers going right (a "good brain") or always left (a "bad brain")
export function preferring(action: 0 | 1): QTable {
  const table = createQTable(5, 2);
  for (let s = 0; s < 5; s++) table.values[s * 2 + action] = 1;
  return table;
}
