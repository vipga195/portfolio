"use client";

import { useCallback, useEffect, useRef } from "react";

import TouchControls from "@/components/games/TouchControls";
import { MAX_HP, MOVES, SUB } from "@/lib/game/fighter/frame-data";
import { BIT } from "@/lib/game/fighter/inputs";
import type { InputMask } from "@/lib/game/fighter/inputs";
import { DIR_COS, DIR_SIN } from "@/lib/game/fighter/world/dirs";
import { createWorldNpc, npcStepWorld } from "@/lib/game/fighter/world/npc";
import type { WorldNpcState } from "@/lib/game/fighter/world/npc";
import { ARC_STEPS, WORLD_HEIGHT, WORLD_WIDTH, createWorld, stepWorld } from "@/lib/game/fighter/world/sim";
import type { Actor, WorldState } from "@/lib/game/fighter/world/sim";

const W=800;
const H=450;
const STEP_MS=1000/60;
const MAX_FRAME_MS=250;
const GRID=100;

const HIP_H=26;
const NECK_H=48;
const HEAD_R=7;
const HAND_H=34;
const POLE_BACK=25;
const POLE_LEN=90;

type Pt={ x: number; y: number };

const KEY_BITS: Record<string, number>={
  a: BIT.LEFT, arrowleft: BIT.LEFT,
  d: BIT.RIGHT, arrowright: BIT.RIGHT,
  w: BIT.UP, arrowup: BIT.UP,
  s: BIT.DOWN, arrowdown: BIT.DOWN,
  j: BIT.THRUST, k: BIT.SWEEP, l: BIT.CHOP,
};

function keyMask(keys: Set<string>): InputMask {
  let mask=0;
  for (const k of keys) mask|=KEY_BITS[k] ?? 0;
  return mask;
}

function lerp(a: number, b: number, t: number): number {
  return a+(b-a)*t;
}

// World pixels to isometric screen space (before the camera offset)
function isoX(x: number, y: number): number {
  return (x-y)*0.5;
}

function isoY(x: number, y: number): number {
  return (x+y)*0.25;
}

function line(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

type PoleShape={ reach: number; tipLift: number; swing: number };

// Pole pose from the attack phase: reach scales the length, tipLift raises the tip (screen px), swing rotates it (radians)
function poleShape(a: Actor): PoleShape {
  if (a.state!=="attack"||a.move===null) return { reach: 1, tipLift: -4, swing: 0 };
  const { startup, active, recovery }=MOVES[a.move];
  const arc=ARC_STEPS[a.move]*Math.PI/8;
  const raised=a.move==="chop"? -70:a.move==="sweep"? -12:0;
  const reach0=a.move==="thrust"? 0.7:1;
  const reach1=a.move==="thrust"? 1.5:1.1;
  const end: PoleShape={ reach: reach1, tipLift: a.move==="chop"? 24:raised/2, swing: a.move==="sweep"? arc:0 };
  const cocked: PoleShape={ reach: reach0, tipLift: raised, swing: a.move==="sweep"? -arc:0 };
  if (a.frame<startup) {
    const t=a.frame/startup;
    return { reach: lerp(1, cocked.reach, t), tipLift: lerp(-4, cocked.tipLift, t), swing: lerp(0, cocked.swing, t) };
  }
  if (a.frame<startup+active) {
    const t=(a.frame-startup+1)/active;
    return { reach: lerp(cocked.reach, end.reach, t), tipLift: lerp(cocked.tipLift, end.tipLift, t), swing: lerp(cocked.swing, end.swing, t) };
  }
  const t=Math.min(1, (a.frame-startup-active)/recovery);
  return { reach: lerp(end.reach, 1, t), tipLift: lerp(end.tipLift, -4, t), swing: lerp(end.swing, 0, t) };
}

// Draws one stick figure in local coordinates: the origin is the actor's foot position on screen
function drawActor(ctx: CanvasRenderingContext2D, a: Actor, sx: number, sy: number, color: string, poleColor: string, fill: string, barBg: string, tick: number): void {
  const ux=DIR_COS[a.dir]/256;
  const uy=DIR_SIN[a.dir]/256;
  // Facing direction in screen space, normalised
  const fx0=isoX(ux, uy);
  const fy0=isoY(ux, uy);
  const fl=Math.hypot(fx0, fy0)||1;
  const fx=fx0/fl;
  const fy=fy0/fl;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.lineCap="round";
  ctx.lineJoin="round";
  ctx.lineWidth=2;
  ctx.strokeStyle=color;

  // Ground shadow
  ctx.fillStyle="rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI*2);
  ctx.fill();

  if (a.state==="dead") {
    ctx.globalAlpha=0.45;
    // Lying flat along the screen x axis, head on the right
    line(ctx, [{ x: -22, y: -3 }, { x: 14, y: -3 }]);
    line(ctx, [{ x: -22, y: -3 }, { x: -32, y: 0 }]);
    line(ctx, [{ x: -22, y: -3 }, { x: -33, y: -6 }]);
    line(ctx, [{ x: 4, y: -3 }, { x: 10, y: -9 }]);
    ctx.beginPath();
    ctx.arc(14+HEAD_R, -3, HEAD_R, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (a.invuln>0&&Math.floor(tick/4)%2===0) ctx.globalAlpha=0.3;

  const lean=a.state==="hitstun"? -8:0;
  const hip: Pt={ x: 0, y: -HIP_H };
  const neck: Pt={ x: lean*fx, y: -NECK_H+lean*fy*0.5 };
  const head: Pt={ x: neck.x+lean*fx*0.2, y: neck.y-HEAD_R-1 };

  // Legs: swing along the facing direction while walking
  const swing=a.state==="walk"? Math.sin(tick*0.3)*9:0;
  const stance=a.state==="attack"? 8:5;
  const feet: Pt[]=[
    { x: fx*(stance+swing), y: fy*(stance+swing)*0.6 },
    { x: -fx*(stance+swing), y: -fy*(stance+swing)*0.6 },
  ];
  for (const foot of feet) line(ctx, [hip, { x: (hip.x+foot.x)/2, y: (hip.y+foot.y)/2 }, foot]);

  line(ctx, [hip, neck]);
  ctx.beginPath();
  ctx.arc(head.x, head.y, HEAD_R, 0, Math.PI*2);
  ctx.stroke();

  // Pole: gripped at hand height, projected from the facing direction
  const shape=poleShape(a);
  const cs=Math.cos(shape.swing);
  const sn=Math.sin(shape.swing);
  const rx=ux*cs-uy*sn;
  const ry=ux*sn+uy*cs;
  const px=isoX(rx, ry);
  const py=isoY(rx, ry);
  const hand: Pt={ x: neck.x+fx*6, y: -HAND_H+fy*3 };
  line(ctx, [{ x: neck.x, y: neck.y+5 }, hand]);
  ctx.strokeStyle=poleColor;
  ctx.lineWidth=3;
  line(ctx, [
    { x: hand.x-px*POLE_BACK, y: hand.y-py*POLE_BACK },
    { x: hand.x+px*POLE_LEN*shape.reach, y: hand.y+py*POLE_LEN*shape.reach+shape.tipLift },
  ]);

  // HP bar above the head
  const bw=30;
  const by=head.y-HEAD_R-8;
  ctx.globalAlpha=1;
  ctx.fillStyle=barBg;
  ctx.fillRect(-bw/2, by, bw, 4);
  ctx.fillStyle=fill;
  ctx.fillRect(-bw/2, by, bw*Math.max(0, a.hp)/MAX_HP, 4);
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, world: WorldState, dark: boolean): void {
  ctx.fillStyle=dark? "#3a3a3a":"#fbfaf5";
  ctx.fillRect(0, 0, W, H);

  const { player, general }=world;
  // Camera centred on the player, rounded to whole pixels
  const camX=Math.round(isoX(player.x/SUB, player.y/SUB))-W/2;
  const camY=Math.round(isoY(player.x/SUB, player.y/SUB))-H/2;
  const scr=(x: number, y: number): Pt => ({ x: isoX(x, y)-camX, y: isoY(x, y)-camY });

  // Paper-grid diamond lattice over the world bounds
  ctx.strokeStyle=dark? "rgba(255,255,255,0.14)":"rgba(96,165,250,0.35)";
  ctx.lineWidth=1;
  for (let gx=0; gx<=WORLD_WIDTH; gx+=GRID) line(ctx, [scr(gx, 0), scr(gx, WORLD_HEIGHT)]);
  for (let gy=0; gy<=WORLD_HEIGHT; gy+=GRID) line(ctx, [scr(0, gy), scr(WORLD_WIDTH, gy)]);

  // World border
  ctx.strokeStyle=dark? "#e5e5e5":"#1f2937";
  ctx.lineWidth=3;
  ctx.lineJoin="round";
  const corners=[scr(0, 0), scr(WORLD_WIDTH, 0), scr(WORLD_WIDTH, WORLD_HEIGHT), scr(0, WORLD_HEIGHT)];
  line(ctx, [...corners, corners[0]]);

  const poleColor=dark? "#d4d4d4":"#0a0a0a";
  const barBg=dark? "#525252":"#d4d4d4";
  const entries=[
    { a: player, color: dark? "#93c5fd":"#1d4ed8", fill: "#16a34a" },
    { a: general, color: dark? "#f87171":"#dc2626", fill: "#ea580c" },
  ].sort((p, q) => (p.a.x+p.a.y)-(q.a.x+q.a.y));
  for (const { a, color, fill } of entries) {
    const s=scr(a.x/SUB, a.y/SUB);
    drawActor(ctx, a, s.x, s.y, color, poleColor, fill, barBg, world.tick);
  }
}

function isTypingTarget(target: EventTarget|null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable||["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function WorldGame(): React.JSX.Element {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const worldRef=useRef<WorldState>(createWorld(1));
  const npcRef=useRef<WorldNpcState>(createWorldNpc(1));
  const keysRef=useRef<Set<string>>(new Set());
  const touchRef=useRef<InputMask>(0);
  const darkRef=useRef(false);

  const onTouch=useCallback((mask: InputMask): void => {
    touchRef.current=mask;
  }, []);

  // Game loop: fixed 60 Hz steps inside requestAnimationFrame
  useEffect(() => {
    const canvas=canvasRef.current;
    const ctx=canvas?.getContext("2d");
    if (!canvas||!ctx) return;
    // Re-applied on resize, which also fires when browser zoom or the monitor's pixel ratio changes
    const applyDpr=(): void => {
      const dpr=Math.min(window.devicePixelRatio||1, 2);
      canvas.width=W*dpr;
      canvas.height=H*dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    applyDpr();
    window.addEventListener("resize", applyDpr);
    canvas.focus({ preventScroll: true });

    const mq=window.matchMedia("(prefers-color-scheme: dark)");
    darkRef.current=mq.matches;
    const onScheme=(): void => { darkRef.current=mq.matches; };
    mq.addEventListener("change", onScheme);

    let raf=0;
    let last: number|null=null;
    let acc=0;
    const frame=(now: number): void => {
      raf=requestAnimationFrame(frame);
      if (document.hidden) {
        last=null;
        return;
      }
      if (last===null) last=now;
      acc+=Math.min(now-last, MAX_FRAME_MS);
      last=now;
      while (acc>=STEP_MS) {
        const world=worldRef.current;
        const [mask, npc]=npcStepWorld(npcRef.current, world);
        npcRef.current=npc;
        worldRef.current=stepWorld(world, [keyMask(keysRef.current)|touchRef.current, mask]);
        acc-=STEP_MS;
      }
      drawScene(ctx, worldRef.current, darkRef.current);
    };
    raf=requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", applyDpr);
      mq.removeEventListener("change", onScheme);
    };
  }, []);

  // Keyboard
  useEffect(() => {
    const keys=keysRef.current;
    const onDown=(e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)||e.metaKey||e.ctrlKey||e.altKey) return;
      const k=e.key.toLowerCase();
      if (KEY_BITS[k]!==undefined) {
        // Only swallow the key while the canvas has focus, so the page can still scroll otherwise
        if (document.activeElement===canvasRef.current) e.preventDefault();
        keys.add(k);
      }
    };
    const onUp=(e: KeyboardEvent): void => {
      keys.delete(e.key.toLowerCase());
    };
    const onBlur=(): void => {
      keys.clear();
      touchRef.current=0;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <div className="flex w-full max-w-[800px] flex-col gap-4">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        tabIndex={0}
        className="aspect-video outline-none w-full rounded-xl border border-neutral-800"
      />
      <TouchControls onChange={onTouch} moveLabels={{ left: "Left", right: "Right", up: "Up", down: "Down" }} />
      <p className="text-center text-xs text-neutral-400">
        WASD or arrows move · J thrust · K sweep · L chop
      </p>
    </div>
  );
}
