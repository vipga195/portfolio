import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GRID_SIZE,
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  clampGridSize,
  createInitialState,
  nextRandom,
  placeFood,
  step,
} from "../../../src/lib/game/snake.ts";
import type { Direction, GameState, Point } from "../../../src/lib/game/snake.ts";

// Fixed food keeps tests deterministic (placeFood is random)
function makeState(overrides: Partial<GameState>={}): GameState {
  return { ...createInitialState(), food: { x: 0, y: 0 }, ...overrides };
}

describe("clampGridSize", () => {
  test("rounds and clamps into the allowed range", () => {
    assert.equal(clampGridSize(7.4), MIN_GRID_SIZE);
    assert.equal(clampGridSize(12.6), 13);
    assert.equal(clampGridSize(100), MAX_GRID_SIZE);
    assert.equal(clampGridSize(-5), MIN_GRID_SIZE);
  });

  test("falls back to the default for non-finite input", () => {
    assert.equal(clampGridSize(NaN), DEFAULT_GRID_SIZE);
    assert.equal(clampGridSize(Infinity), DEFAULT_GRID_SIZE);
    assert.equal(clampGridSize(-Infinity), DEFAULT_GRID_SIZE);
  });
});

describe("createInitialState", () => {
  test("places a 3-segment snake in the middle for min, default and max sizes", () => {
    for (const size of [MIN_GRID_SIZE, DEFAULT_GRID_SIZE, MAX_GRID_SIZE]) {
      const s=createInitialState(size);
      const mid=Math.floor(size/2);
      assert.equal(s.gridSize, size);
      assert.equal(s.alive, true);
      assert.deepEqual(s.snake[0], { x: mid, y: mid });
      assert.equal(s.snake.length, 3);
      assert.ok(s.snake.every((p) => p.x>=0&&p.x<size&&p.y>=0&&p.y<size));
    }
  });

  test("clamps an out-of-range size", () => {
    assert.equal(createInitialState(999).gridSize, MAX_GRID_SIZE);
  });
});

describe("step", () => {
  test("moves head one cell and keeps length", () => {
    const s=makeState();
    const next=step(s, "down");
    assert.deepEqual(next.snake[0], { x: 10, y: 11 });
    assert.equal(next.snake.length, s.snake.length);
  });

  test("eating food grows snake and adds score", () => {
    const s=makeState({ food: { x: 10, y: 11 }, bulges: [0] });
    const next=step(s, "down");
    assert.equal(next.snake.length, s.snake.length+1);
    assert.equal(next.score, 1);
  });

  test("hitting the wall kills the snake on every side", () => {
    const size=10;
    const cases: { dir: Direction; snake: Point[] }[]=[
      { dir: "left", snake: [{ x: 0, y: 5 }, { x: 1, y: 5 }] },
      { dir: "right", snake: [{ x: size-1, y: 5 }, { x: size-2, y: 5 }] },
      { dir: "up", snake: [{ x: 5, y: 0 }, { x: 5, y: 1 }] },
      { dir: "down", snake: [{ x: 5, y: size-1 }, { x: 5, y: size-2 }] },
    ];
    for (const { dir, snake } of cases) {
      const s={ ...createInitialState(size), snake, dir, food: { x: 3, y: 3 } };
      assert.equal(step(s, dir).alive, false, `expected death moving ${dir}`);
    }
  });

  test("biting itself kills the snake", () => {
    const snake: Point[]=[
      { x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }, { x: 4, y: 7 }, { x: 4, y: 6 }, { x: 4, y: 5 },
    ];
    const s=makeState({ snake, dir: "up" });
    assert.equal(step(s, "left").alive, false);
  });

  test("cannot reverse direction", () => {
    const s=makeState({ dir: "down" });
    assert.equal(step(s, "up").dir, "down");
  });

  test("a dead snake returns the same state", () => {
    const s=makeState({ alive: false });
    assert.equal(step(s, "down"), s);
  });

  test("does not mutate the previous state", () => {
    const s=makeState({ food: { x: 10, y: 11 } });
    const length=s.snake.length;
    step(s, "down");
    assert.equal(s.snake.length, length);
    assert.equal(s.score, 0);
  });

  test("an eaten bulge starts at the head, moves one segment per tick and leaves past the tail", () => {
    let s=makeState({ food: { x: 10, y: 11 } });
    s=step(s, "down");
    assert.deepEqual(s.bulges, [0]);
    // The new food is random: pin it away from the snake's path so it cannot be eaten again
    s={ ...s, food: { x: 0, y: 0 } };
    s=step(s, "down");
    assert.deepEqual(s.bulges, [1]);
    for (let i=0; i<10; i++) s=step(s, "down");
    assert.deepEqual(s.bulges, []);
  });
});

describe("placeFood", () => {
  test("never lands on the snake and stays inside the grid", () => {
    const gridSize=10;
    const snake=[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    let seed=1;
    for (let i=0; i<200; i++) {
      const [r, next]=nextRandom(seed);
      seed=next;
      const f=placeFood(snake, gridSize, r);
      assert.ok(Number.isInteger(f.x)&&Number.isInteger(f.y));
      assert.ok(f.x>=0&&f.x<gridSize&&f.y>=0&&f.y<gridSize);
      assert.ok(!snake.some((p) => p.x===f.x&&p.y===f.y));
    }
  });

  test("the same random value always picks the same cell", () => {
    const snake=[{ x: 0, y: 0 }, { x: 1, y: 0 }];
    assert.deepEqual(placeFood(snake, 10, 0.5), placeFood(snake, 10, 0.5));
  });
});

describe("nextRandom", () => {
  test("matches known mulberry32 reference values (same numbers in every JS engine)", () => {
    assert.deepEqual(nextRandom(0), [0.26642920868471265, 1831565813]);
    let seed=12345;
    const values: number[]=[];
    for (let i=0; i<3; i++) {
      const [v, next]=nextRandom(seed);
      values.push(v);
      seed=next;
    }
    assert.deepEqual(values, [0.9797282677609473, 0.3067522644996643, 0.484205421525985]);
  });

  test("is pure: the same seed gives the same pair", () => {
    assert.deepEqual(nextRandom(777), nextRandom(777));
  });

  test("always returns a value in [0, 1) and a valid 32-bit next seed", () => {
    let seed=0xffffffff;
    let sum=0;
    for (let i=0; i<10000; i++) {
      const [v, next]=nextRandom(seed);
      assert.ok(v>=0&&v<1);
      assert.ok(Number.isInteger(next)&&next>=0&&next<4294967296);
      sum+=v;
      seed=next;
    }
    const mean=sum/10000;
    assert.ok(mean>0.45&&mean<0.55, `mean ${mean} looks biased`);
  });
});

describe("seeded games", () => {
  test("the same seed gives the same initial state, another seed another food", () => {
    assert.deepEqual(createInitialState(10, 42), createInitialState(10, 42));
    assert.deepEqual(createInitialState(10, 42).food, { x: 1, y: 6 });
    const foods=new Set<string>();
    for (let seed=0; seed<30; seed++) {
      const f=createInitialState(10, seed).food;
      foods.add(`${f.x},${f.y}`);
    }
    assert.ok(foods.size>5, "different seeds should give different food");
  });

  test("normalises any number into a 32-bit seed", () => {
    assert.equal(createInitialState(10, 2**32+5).seed, createInitialState(10, 5).seed);
  });

  test("the seed only advances when food is placed", () => {
    const s=createInitialState(20, 99);
    const moved=step({ ...s, food: { x: 0, y: 0 } }, "down");
    assert.equal(moved.seed, s.seed, "no food eaten: seed unchanged");
    const ate=step({ ...s, food: { x: 10, y: 11 } }, "down");
    assert.notEqual(ate.seed, s.seed, "food eaten: seed advanced");
  });

  test("two identical games stay identical after eating", () => {
    const a=createInitialState(10, 7);
    const b=createInitialState(10, 7);
    let sa=a;
    let sb=b;
    for (let i=0; i<30; i++) {
      sa=step(sa, i%7===0? "left":"down");
      sb=step(sb, i%7===0? "left":"down");
    }
    assert.deepEqual(sa, sb);
  });
});

describe('won', () => {
  test("eating the last free cell wins the game", () => {
    const size=8;
    const path: Point[]=[];
    for (let y=0; y<size; y++) {
      for (let i=0; i<size; i++) path.push({ x: y%2===0? i:size-1-i, y });
    }
    const s={
      ...createInitialState(size),
      snake: path.slice(0, size*size-1).reverse(),   // head is path[62], next to the last cell
      food: path[size*size-1],
      dir: "left" as const,
      bulges: [],
    };
    const next=step(s, "left");
    assert.equal(next.won, true);
    assert.equal(next.alive, false);
    assert.equal(next.snake.length, size*size);
  });
}) 