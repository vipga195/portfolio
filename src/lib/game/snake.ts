export const DEFAULT_GRID_SIZE=20;
export const MIN_GRID_SIZE=8;
export const MAX_GRID_SIZE=40;
// Transitional alias, still imported by SnakeGame.tsx; remove once that file reads gridSize from the state
export const GRID_SIZE=DEFAULT_GRID_SIZE;
// Keep a bulge until it has fully slid past the tail (its bump spans BULGE_WIDTH segments)
const BULGE_WIDTH=2;

export type Point={ x: number; y: number };
export type Direction="up"|"down"|"left"|"right";
export type GameState={
  snake: Point[];
  food: Point;
  dir: Direction;
  score: number;
  alive: boolean;
  gridSize: number;
  bulges: number[];
  won: boolean;
  // State of the random generator (see nextRandom). Lives in the game state so `step` stays pure and a game can be replayed exactly.
  seed: number;
};

export const VECTORS: Record<Direction, Point>={
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction>={
  up: "down", down: "up", left: "right", right: "left",
};

function samePoint(a: Point, b: Point): boolean {
  return a.x===b.x&&a.y===b.y;
}

// User input is untrusted: force an integer inside the allowed range
export function clampGridSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GRID_SIZE;
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(value)));
}

// mulberry32: a tiny seeded generator. Pure: the same seed always gives the same [value in [0, 1), nextSeed] pair,
// on every browser and in Node (integer math only). Not cryptographic, it exists so games can be replayed.
export function nextRandom(seed: number): [number, number] {
  const next=(seed+0x6d2b79f5)>>>0;
  let t=next;
  t=Math.imul(t^(t>>>15), t|1);
  t^=t+Math.imul(t^(t>>>7), t|61);
  return [((t^(t>>>14))>>>0)/4294967296, next];
}

// Only used when a new game is created without an explicit seed; `step` never calls Math.random
export function randomSeed(): number {
  return Math.floor(Math.random()*4294967296);
}

// `r` is a random value in [0, 1) supplied by the caller (from nextRandom), so food placement is reproducible
export function placeFood(snake: Point[], gridSize: number, r: number): Point {
  const empty: Point[]=[];
  for (let y=0; y<gridSize; y++) {
    for (let x=0; x<gridSize; x++) {
      const occupied=snake.some((p) => p.x===x&&p.y===y);
      if (!occupied) empty.push({ x, y });
    }
  }
  const index=Math.floor(r*empty.length);
  return empty[index];
}

export function createInitialState(gridSize: number=DEFAULT_GRID_SIZE, seed: number=randomSeed()): GameState {
  const size=clampGridSize(gridSize);
  const mid=Math.floor(size/2);
  // Head is at the bottom, body above it, moving down -> the snake cannot hit itself on the first step
  const snake: Point[]=[{ x: mid, y: mid }, { x: mid, y: mid-1 }, { x: mid, y: mid-2 }];
  const [r, nextSeed]=nextRandom(seed>>>0);   // >>> 0 keeps any number a valid 32-bit seed
  return { snake, food: placeFood(snake, size, r), dir: "down", score: 0, alive: true, gridSize: size, bulges: [], won: false, seed: nextSeed };
}

export function isOutOfBounds(p: Point, gridSize: number): boolean {
  return p.x<0||p.x>=gridSize||p.y<0||p.y>=gridSize;
}

export function step(state: GameState, nextDir: Direction): GameState {
  if (!state.alive) return state;

  const dir=nextDir===OPPOSITE[state.dir]? state.dir:nextDir;

  const head=state.snake[0];
  const newHead={ x: head.x+VECTORS[dir].x, y: head.y+VECTORS[dir].y };

  if (isOutOfBounds(newHead, state.gridSize)||state.snake.some((p) => samePoint(p, newHead))) {
    return { ...state, dir, alive: false };
  }

  const ate=samePoint(newHead, state.food);

  const grown=[newHead, ...state.snake];
  const snake=ate? grown:grown.slice(0, -1);

  // Bulges travel one segment toward the tail per tick; drop the ones past the tail
  const shifted=state.bulges.map((i) => i+1).filter((i) => i<snake.length+BULGE_WIDTH);
  if (ate&&snake.length===state.gridSize*state.gridSize) {
    return {
      ...state,
      dir,
      snake,
      score: state.score+1,
      alive: false,
      won: true,
      bulges: [0, ...shifted],
    };
  }
  // The random generator only advances when new food is needed, on the client and on a replaying server alike
  const [r, nextSeed]=nextRandom(state.seed);
  return {
    ...state,
    dir,
    snake,
    score: ate? state.score+1:state.score,
    food: ate? placeFood(snake, state.gridSize, r):state.food,
    bulges: ate? [0, ...shifted]:shifted,
    seed: ate? nextSeed:state.seed,
  };
}
