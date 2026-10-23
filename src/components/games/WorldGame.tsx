"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import TouchControls from "@/components/games/TouchControls";
import { MAX_HP, SUB } from "@/lib/game/fighter/frame-data";
import type { InputMask } from "@/lib/game/fighter/inputs";
import { DIR_COS, DIR_SIN, screenToWorldMask } from "@/lib/game/fighter/world/dirs";
import { WEAPON_DURABILITY, WORLD_MOVES } from "@/lib/game/fighter/world/moves";
import type { WeaponKind, WorldMoveId } from "@/lib/game/fighter/world/moves";
import { npcStepWorld } from "@/lib/game/fighter/world/npc";
import type { WorldNpcState } from "@/lib/game/fighter/world/npc";
import { WORLD_HEIGHT, WORLD_WIDTH, createWorldSession, stepWorld } from "@/lib/game/fighter/world/sim";
import type { Actor, Item, WorldState } from "@/lib/game/fighter/world/sim";
import { WBIT } from "@/lib/game/fighter/world/winputs";

const W=800;
const H=450;
const STEP_MS=1000/60;
const MAX_FRAME_MS=250;
const GRID=100;

const HIP_H=26;
const NECK_H=48;
const HEAD_R=7;
const POLE_BACK=25;
const POLE_LEN: Record<WeaponKind, number>={ spear: 90, staff: 70 };
const ITEM_HALF_LEN: Record<WeaponKind, number>={ spear: 40, staff: 28 };

type Pt={ x: number; y: number };

// Physical key codes, so WASD keeps its position on AZERTY and other layouts
const KEY_BITS: Record<string, number>={
  KeyA: WBIT.LEFT, ArrowLeft: WBIT.LEFT,
  KeyD: WBIT.RIGHT, ArrowRight: WBIT.RIGHT,
  KeyW: WBIT.UP, ArrowUp: WBIT.UP,
  KeyS: WBIT.DOWN, ArrowDown: WBIT.DOWN,
  KeyJ: WBIT.ATK_A, KeyK: WBIT.ATK_B, KeyL: WBIT.ATK_C,
  ShiftLeft: WBIT.RUN, ShiftRight: WBIT.RUN,
  KeyC: WBIT.CROUCH,
  KeyE: WBIT.PICKUP,
};

const TOUCH_EXTRAS=[
  { id: "run", label: "Run", bit: WBIT.RUN },
  { id: "duck", label: "Crouch", bit: WBIT.CROUCH },
  { id: "pickup", label: "Pick up", bit: WBIT.PICKUP },
];

function keyMask(keys: Set<string>): InputMask {
  let mask=0;
  for (const k of keys) mask|=KEY_BITS[k] ?? 0;
  return mask;
}

function lerp(a: number, b: number, t: number): number {
  return a+(b-a)*t;
}

// World pixels to a low, flat isometric screen space (before the camera offset)
function isoX(x: number, y: number): number {
  return (x-y)*0.5;
}

function isoY(x: number, y: number): number {
  return (x+y)*0.125;
}

function line(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

type MoveKind="punch"|"kick"|"heavy"|"low"|"upper"|"spin"|"dash"|"thrust"|"sweep"|"chop";

const MOVE_KIND: Record<WorldMoveId, MoveKind>={
  punch: "punch", kick: "kick", heavy: "heavy", lowKick: "low", uppercut: "upper", spin: "spin", dash: "dash",
  wThrust: "thrust", wSweep: "sweep", wChop: "chop", sThrust: "thrust", sSweep: "sweep", sChop: "chop",
};

// How far the striking limb is extended, 0 (rest) to 1 (full): winds up through startup, peaks in active, retracts in recovery
function attackExt(a: Actor): number {
  if (a.state!=="attack"||a.move===null) return 0;
  const { startup, active, recovery }=WORLD_MOVES[a.move];
  if (a.frame<startup) return 0.4*a.frame/startup;
  if (a.frame<startup+active) return lerp(0.4, 1, (a.frame-startup+1)/active);
  return 1-Math.min(1, (a.frame-startup-active)/recovery);
}

type PoleShape={ reach: number; tipLift: number; swing: number };

// Pole pose from the attack phase: reach scales the length, tipLift raises the tip (screen px), swing rotates it (radians)
function poleShape(a: Actor): PoleShape {
  const rest: PoleShape={ reach: 1, tipLift: -4, swing: 0 };
  if (a.state!=="attack"||a.move===null) return rest;
  const kind=MOVE_KIND[a.move];
  if (kind!=="thrust"&&kind!=="sweep"&&kind!=="chop") return rest;
  const { startup, active, recovery, arcSteps }=WORLD_MOVES[a.move];
  const arc=arcSteps*Math.PI/8;
  const raised=kind==="chop"? -70:kind==="sweep"? -12:0;
  const reach0=kind==="thrust"? 0.7:1;
  const reach1=kind==="thrust"? 1.5:1.1;
  const end: PoleShape={ reach: reach1, tipLift: kind==="chop"? 24:raised/2, swing: kind==="sweep"? arc:0 };
  const cocked: PoleShape={ reach: reach0, tipLift: raised, swing: kind==="sweep"? -arc:0 };
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
  ctx.ellipse(0, 0, 16, 4, 0, 0, Math.PI*2);
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

  const kind=a.state==="attack"&&a.move!==null? MOVE_KIND[a.move]:null;
  const e=attackExt(a);
  const ducking=a.state==="crouch"||kind==="low"||kind==="upper"||a.state==="pickup";
  const running=a.state==="run";
  const moving=running||a.state==="walk";

  // Torso: crouching lowers the hips and neck, running and dashing lean forward, a hit leans back
  const hipY=ducking? -HIP_H*0.6:-HIP_H;
  const neckY=ducking? -NECK_H*0.7:-NECK_H;
  let lean=a.state==="hitstun"? -8:running? 7:kind==="dash"? 10*e:kind==="kick"||kind==="heavy"? -6*e:0;
  if (a.state==="pickup") lean=10*Math.sin(Math.min(1, a.frame/8)*Math.PI);
  const hip: Pt={ x: 0, y: hipY };
  const neck: Pt={ x: lean*fx, y: neckY+lean*fy*0.5 };
  const head: Pt={ x: neck.x+lean*fx*0.2, y: neck.y-HEAD_R-1 };
  const shoulder: Pt={ x: neck.x, y: neck.y+5 };

  // Default limb swing along the facing direction while moving
  const swing=moving? Math.sin(tick*(running? 0.5:0.3))*(running? 14:9):0;
  const stance=a.state==="attack"? 8:5;
  const reach=(len: number): Pt => ({ x: fx*len, y: fy*len*0.5 });
  let footA: Pt=reach(stance+swing);
  let footB: Pt=reach(-(stance+swing));
  let handA: Pt={ x: shoulder.x+fx*(6-swing*0.5), y: shoulder.y+11 };
  let handB: Pt={ x: shoulder.x-fx*(6-swing*0.5), y: shoulder.y+11 };

  if (kind==="punch") {
    handA={ x: shoulder.x+fx*(8+28*e), y: shoulder.y+4 };
    handB={ x: shoulder.x+fx*5, y: shoulder.y+7 };
  } else if (kind==="upper") {
    handA={ x: shoulder.x+fx*(8+10*e), y: shoulder.y+10-38*e };
    handB={ x: shoulder.x+fx*4, y: shoulder.y+8 };
  } else if (kind==="kick") {
    footA={ x: fx*(8+34*e), y: fy*17*e+(hipY+6)*e };
  } else if (kind==="heavy") {
    footA={ x: fx*(6+30*e), y: fy*15*e+(neckY+12)*e };
  } else if (kind==="low") {
    footA={ x: fx*(10+36*e), y: fy*18*e-3 };
  } else if (kind==="dash") {
    footA={ x: fx*(8+34*e), y: fy*17*e+(hipY+16)*e };
    handA={ x: shoulder.x-fx*8, y: shoulder.y+6 };
    handB={ x: shoulder.x-fx*12, y: shoulder.y+9 };
  } else if (kind==="spin") {
    // The kicking leg and the lead hand orbit the body through one full circle over the move
    const m=WORLD_MOVES.spin;
    const th=Math.PI*2*a.frame/(m.startup+m.active+m.recovery);
    footA={ x: Math.cos(th)*34, y: hipY+4+Math.sin(th)*7 };
    handA={ x: shoulder.x-Math.cos(th)*14, y: shoulder.y+8-Math.sin(th)*3 };
  }

  const spinning=kind==="spin";
  if (spinning) footB={ x: -footA.x*0.3, y: 0 };
  for (const foot of [footA, footB]) line(ctx, [hip, { x: (hip.x+foot.x)/2+(ducking? fx*4:0), y: (hip.y+foot.y)/2 }, foot]);

  line(ctx, [hip, neck]);
  ctx.beginPath();
  ctx.arc(head.x, head.y, HEAD_R, 0, Math.PI*2);
  ctx.stroke();

  // Arms: elbow midway, a little lower than the straight line
  for (const hand of [handA, handB]) line(ctx, [shoulder, { x: (shoulder.x+hand.x)/2, y: (shoulder.y+hand.y)/2+2 }, hand]);

  if (a.state==="pickup") {
    // Hand reaches down toward the ground
    handA={ x: shoulder.x+fx*10, y: -4 };
    line(ctx, [shoulder, handA]);
  }

  // Held weapon: gripped in the lead hand, projected from the facing direction
  if (a.weapon!==null) {
    const shape=poleShape(a);
    const cs=Math.cos(shape.swing);
    const sn=Math.sin(shape.swing);
    const rx=ux*cs-uy*sn;
    const ry=ux*sn+uy*cs;
    const px=isoX(rx, ry);
    const py=isoY(rx, ry);
    const grip: Pt=handA;
    ctx.strokeStyle=poleColor;
    ctx.lineWidth=3;
    line(ctx, [
      { x: grip.x-px*POLE_BACK, y: grip.y-py*POLE_BACK },
      { x: grip.x+px*POLE_LEN[a.weapon]*shape.reach, y: grip.y+py*POLE_LEN[a.weapon]*shape.reach+shape.tipLift },
    ]);
  }

  // HP bar above the head, weapon durability right under it
  const bw=30;
  const by=head.y-HEAD_R-9;
  ctx.globalAlpha=1;
  ctx.fillStyle=barBg;
  ctx.fillRect(-bw/2, by, bw, 4);
  ctx.fillStyle=fill;
  ctx.fillRect(-bw/2, by, bw*Math.max(0, a.hp)/MAX_HP, 4);
  if (a.weapon!==null) {
    ctx.fillStyle=barBg;
    ctx.fillRect(-bw/2, by+5, bw, 2);
    ctx.fillStyle="#f59e0b";
    ctx.fillRect(-bw/2, by+5, bw*Math.max(0, a.durability)/WEAPON_DURABILITY[a.weapon], 2);
  }
  ctx.restore();
}

// A weapon lying on the ground: a line along the screen x axis with a pulsing highlight ring and a bright tip
function drawItem(ctx: CanvasRenderingContext2D, item: Item, scr: (x: number, y: number) => Pt, color: string, tick: number): void {
  const cx=item.x/SUB;
  const cy=item.y/SUB;
  const half=ITEM_HALF_LEN[item.kind]*Math.SQRT1_2;
  const tail=scr(cx-half, cy+half);
  const tip=scr(cx+half, cy-half);
  const mid=scr(cx, cy);
  ctx.save();
  ctx.lineCap="round";
  ctx.strokeStyle=color;
  ctx.lineWidth=item.kind==="spear"? 3:4;
  line(ctx, [tail, tip]);
  ctx.fillStyle="#f59e0b";
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 3, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle="#f59e0b";
  ctx.lineWidth=1.5;
  ctx.globalAlpha=0.5+0.4*Math.sin(tick*0.1);
  ctx.beginPath();
  ctx.ellipse(mid.x, mid.y, 10+Math.sin(tick*0.1)*2, 4, 0, 0, Math.PI*2);
  ctx.stroke();
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
  for (const item of world.items) drawItem(ctx, item, scr, poleColor, world.tick);
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
  const [session]=useState(() => createWorldSession(1));
  const worldRef=useRef<WorldState>(session.world);
  const npcRef=useRef<WorldNpcState>(session.npc);
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
        worldRef.current=stepWorld(world, [screenToWorldMask(keyMask(keysRef.current)|touchRef.current), mask]);
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
    const canvas=canvasRef.current;
    const onDown=(e: KeyboardEvent): void => {
      // macOS sends no keyup for held keys while Cmd is down, so drop them instead of letting them stick
      if (e.metaKey) keys.clear();
      if (isTypingTarget(e.target)||e.metaKey||e.ctrlKey||e.altKey) return;
      // Only react while the canvas has focus, so the page can still scroll with the arrow keys otherwise
      if (document.activeElement!==canvas||KEY_BITS[e.code]===undefined) return;
      e.preventDefault();
      keys.add(e.code);
    };
    const onUp=(e: KeyboardEvent): void => {
      if (e.code==="MetaLeft"||e.code==="MetaRight") keys.clear();
      keys.delete(e.code);
    };
    const onBlur=(): void => {
      keys.clear();
      touchRef.current=0;
    };
    canvas?.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      canvas?.removeEventListener("blur", onBlur);
    };
  }, []);

  return (
    <div className="flex w-full max-w-[800px] flex-col gap-4">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        tabIndex={0}
        role="application"
        aria-label="Stick fighter open world. Click to focus, then WASD or arrows move; J punch, K kick, L heavy; Shift run; C crouch; E pick up or drop."
        className="aspect-video w-full rounded-xl border border-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      />
      <TouchControls
        onChange={onTouch}
        moveLabels={{ left: "Left", right: "Right", up: "Up", down: "Down" }}
        attackLabels={["Punch", "Kick", "Heavy"]}
        extraButtons={TOUCH_EXTRAS}
      />
      <p className="text-center text-xs text-neutral-400">
        Click the game, then WASD or arrows move · Shift run · C crouch · E pick up / drop · J punch · K kick · L heavy
        <br />
        Combos: J J K chain · C+J uppercut · K+L spin kick · double-tap a direction then K = dash kick
      </p>
    </div>
  );
}
