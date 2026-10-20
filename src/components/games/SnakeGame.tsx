"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Direction, GameState } from "@/lib/game/snake";
import { MAX_GRID_SIZE, MIN_GRID_SIZE, clampGridSize, createInitialState, step } from "@/lib/game/snake";
// AI
import { parseBrain } from "@/lib/ai/brain";
import type { QTable } from "@/lib/ai/qlearning";
import { snakeEnv, snakePickDirection, snakeStepLimit } from "@/lib/game/snake-env";

const CELL=20;

const BULGE_AMP=0.5;    // how much bigger the bulge gets
const BULGE_WIDTH=2;    // how many segments the bump spreads over

const TICK_MS=140;
const MAX_FRAME_MS=250;

const HEAD_COLOR="#3b82f6";
const BODY_COLOR="#1d4ed8";

type Seg={ x: number; y: number; size: number };

function segAt(prev: GameState, curr: GameState, i: number, alpha: number, centers: number[]): Seg {
  const to=curr.snake[i];
  const from=prev.snake[Math.min(i, prev.snake.length-1)];
  const size=CELL*scaleAt(i, centers);
  const offset=(CELL-size)/2;
  return {
    x: lerp(from.x, to.x, alpha)*CELL+offset,
    y: lerp(from.y, to.y, alpha)*CELL+offset,
    size,
  };
}

function fillUnion(ctx: CanvasRenderingContext2D, a: Seg, b: Seg): void {
  const x1=Math.min(a.x, b.x);
  const y1=Math.min(a.y, b.y);
  const x2=Math.max(a.x+a.size, b.x+b.size);
  const y2=Math.max(a.y+a.size, b.y+b.size);
  ctx.fillRect(x1, y1, x2-x1, y2-y1);
}

function scaleAt(i: number, bulges: number[]): number {
  let s=1;
  for (const b of bulges) {
    const bump=Math.max(0, 1-Math.abs(i-b)/BULGE_WIDTH);
    s=Math.max(s, 1+BULGE_AMP*bump);
  }
  return s;
}

function lerp(a: number, b: number, t: number): number {
  return a+(b-a)*t;
}

function draw(ctx: CanvasRenderingContext2D, prev: GameState, curr: GameState, alpha: number): void {
  const size=curr.gridSize*CELL;
  const cell=size/curr.gridSize;
  // 1. Background
  ctx.fillStyle="#0a0a0a";
  ctx.fillRect(0, 0, size, size);

  // 2. Food
  ctx.fillStyle="#f87171";
  ctx.fillRect(curr.food.x*cell, curr.food.y*cell, cell, cell);

  // 3. Snake, tail -> head so the head is drawn on top of bulged neighbours
  // Bulges are stored as indices at the current tick; mid-tick they sit one segment back
  const centers=curr.bulges.map((b) => b-1+alpha);

  for (let i=curr.snake.length-1; i>=0; i--) {
    const seg=segAt(prev, curr, i, alpha, centers);

    // Connector between this segment and the next one toward the tail fills the corner gap;
    // always body color, otherwise the head looks two cells long
    if (i<curr.snake.length-1) {
      ctx.fillStyle=BODY_COLOR;
      fillUnion(ctx, seg, segAt(prev, curr, i+1, alpha, centers));
    }

    // The segment itself goes on top of its connector
    ctx.fillStyle=i===0? HEAD_COLOR:BODY_COLOR;
    ctx.fillRect(seg.x, seg.y, seg.size, seg.size);
  }
}

const KEY_TO_DIR: Record<string, Direction>={
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", s: "down", a: "left", d: "right",
};

export default function SnakeGame(): React.JSX.Element {
  const [state, setState]=useState<GameState>(createInitialState);
  const [running, setRunning]=useState(false);
  const [aiOn, setAiOn]=useState(false);
  const [brainStatus, setBrainStatus]=useState<"idle"|"loading"|"ready"|"error">("idle");

  const brainRef=useRef<QTable|null>(null);
  const aiOnRef=useRef(false);
  const sinceFoodRef=useRef(0);

  const canvasRef=useRef<HTMLCanvasElement>(null);
  const dirRef=useRef<Direction>("down");
  const prevRef=useRef<GameState>(state)
  const currRef=useRef<GameState>(state)

  const playing=running&&state.alive;
  const canvasSize=state.gridSize*CELL;
  // With AI on, the game cannot start until the brain is loaded (otherwise the snake just drives straight)
  const brainBlocked=aiOn&&brainStatus!=="ready";

  const changeGrid=useCallback((value: number): void => {
    const fresh=createInitialState(clampGridSize(value));   // clamp: never trust the input
    sinceFoodRef.current=0
    prevRef.current=fresh;
    currRef.current=fresh;
    dirRef.current="down";
    setRunning(false);
    setState(fresh);
  }, []);

  const start=useCallback((): void => {
    if (aiOnRef.current&&!brainRef.current) return;
    if (!currRef.current.alive) {
      const fresh=createInitialState(currRef.current.gridSize);
      sinceFoodRef.current=0
      prevRef.current=fresh;
      currRef.current=fresh;
      setState(fresh);
    }
    // A fresh game heads "down"; resuming a paused game keeps the snake's own heading
    dirRef.current=currRef.current.dir;
    setRunning(true);
  }, []);

  const togglePause=useCallback((): void => {
    // Never start a game with AI on before its brain is loaded
    setRunning((r) => (r? false:!aiOnRef.current||brainRef.current!==null));
  }, []);

  useEffect(() => {
    aiOnRef.current=aiOn;
    if (!aiOn||brainRef.current) return;
    let cancelled=false;
    setBrainStatus("loading");
    fetch("/brains/snake.json")
      .then((res) => (res.ok? res.json():Promise.reject(new Error("bad status"))))
      .then((json: unknown) => {
        const table=parseBrain(json, snakeEnv);          // validates shape, never trust the file
        if (cancelled) return;
        brainRef.current=table;
        setBrainStatus(table? "ready":"error");
      })
      .catch(() => { if (!cancelled) setBrainStatus("error"); });
    return () => { cancelled=true; };
  }, [aiOn]);

  useEffect(() => {
    if (playing) return;                         // while playing, the rAF loop owns drawing
    const ctx=canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const curr=currRef.current;                  // not `state`: it only syncs on score/alive changes, so it lags while paused
    draw(ctx, curr, curr, 1);                    // static frame: no interpolation
  }, [state, playing]);

  useEffect(() => {
    const onKeyDown=(e: KeyboardEvent): void => {
      const dir=KEY_TO_DIR[e.key];
      if (e.key===" "||e.code==="Space") {
        togglePause();
        return;
      }
      if (!dir) return;
      e.preventDefault();       // stop the page from scrolling on arrow keys
      if (aiOnRef.current) return;
      dirRef.current=dir;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePause]);

  useEffect(() => {
    if (!playing) return;
    const ctx=canvasRef.current?.getContext("2d");
    if (!ctx) return;

    let raf=0;
    let last=performance.now();
    let acc=0;

    const frame=(now: number): void => {
      acc+=Math.min(now-last, MAX_FRAME_MS);
      last=now;

      while (acc>=TICK_MS) {
        prevRef.current=currRef.current;
        if (aiOnRef.current&&brainRef.current) {
          dirRef.current=snakePickDirection(brainRef.current, currRef.current);
        }

        currRef.current=step(currRef.current, dirRef.current);
        sinceFoodRef.current=currRef.current.score!==prevRef.current.score? 0:sinceFoodRef.current+1;
        if (aiOnRef.current&&sinceFoodRef.current>snakeStepLimit(currRef.current.gridSize)) {
          currRef.current={ ...currRef.current, alive: false };   // AI is looping: end the game
        }
        acc-=TICK_MS;

        const { score, alive }=currRef.current;
        if (score!==prevRef.current.score||alive!==prevRef.current.alive) {
          setState(currRef.current);          // sync UI only when score/alive changed
        }
      }

      draw(ctx, prevRef.current, currRef.current, acc/TICK_MS);
      raf=requestAnimationFrame(frame);
    };

    raf=requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);   // required cleanup
  }, [playing]);


  return (
    <>


      <div className="relative w-full flex flex-col transition-all" style={{ maxWidth: canvasSize }}>
        <canvas
          ref={canvasRef}
          width={canvasSize}
          height={canvasSize}
          className="w-full rounded-xl border border-neutral-800"
        />
        <p aria-live="polite">Score: {state.score}</p>

        {!playing&&(
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-black/60">
            <div className="text-center">
              {!state.alive && <p className="mb-3 text-xl font-semibold">{state.won ? "You win!" : "Game over"}</p>}
              <button type="button" onClick={start} disabled={brainBlocked}
                className="rounded-full bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-50">
                {state.alive? "Start":"Restart"}
              </button>
            </div>
          </div>
        )}

        <div className="absolute right-0 top-0 -translate-y-full bg-[rgb(0_0_0/30%)]">
          <div>
            <label className="mt-3 flex items-center gap-3 text-sm text-neutral-300">
              Grid {state.gridSize}×{state.gridSize}
              <input
                type="range"
                min={MIN_GRID_SIZE}
                max={MAX_GRID_SIZE}
                value={state.gridSize}
                disabled={playing}
                onChange={(e) => changeGrid(Number(e.target.value))}
              />
            </label>
          </div>
          <div>
            <button type="button" onClick={() => setAiOn((v) => !v)} disabled={playing}>
              {aiOn? "AI: on":"AI: off"}
            </button>
            {aiOn&&brainStatus==="loading"&&<p>Loading brain…</p>}
            {aiOn&&brainStatus==="error"&&<p role="alert">Could not load the AI brain.</p>}
          </div>
        </div>
      </div>

    </>

  );
}