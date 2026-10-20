// mulberry32: a tiny seeded generator. Pure: the same seed always gives the same [value in [0, 1), nextSeed] pair,
// on every browser and in Node (integer math only). Not cryptographic, it exists so games can be replayed.
export function nextRandom(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

// A stateful () => number built on nextRandom, for code that takes an rng function (training, evaluation).
// The same seed always produces the same sequence.
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    const [value, next] = nextRandom(state);
    state = next;
    return value;
  };
}
