"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import TouchControls from "@/components/games/TouchControls";
import { MAX_HP, SUB } from "@/lib/game/fighter/frame-data";
import type { InputMask } from "@/lib/game/fighter/inputs";
import { ARCHETYPES, LEVELS } from "@/lib/game/fighter/world/archetypes";
import type { Archetype, Level } from "@/lib/game/fighter/world/archetypes";
import { DIR_COS, DIR_SIN } from "@/lib/game/fighter/world/dirs";
import { WEAPON_DURABILITY, WORLD_MOVES } from "@/lib/game/fighter/world/moves";
import type { WeaponKind, WorldMoveId } from "@/lib/game/fighter/world/moves";
import { createBrainNpc, defaultEpsilon, npcStepBrain, parseFighterBrain } from "@/lib/game/fighter/world/npc-brain";
import type { BrainNpcState, FighterBrain } from "@/lib/game/fighter/world/npc-brain";
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

const SKILLS: { name: string; keys: string; desc: string }[]=[
  { name: "Chain", keys: "J, J, K", desc: "Third hit does +30% damage and extra knockback; each link must hit to cancel" },
  { name: "Uppercut", keys: "C + J", desc: "Crouching launcher, high damage" },
  { name: "Spin kick", keys: "K + L", desc: "Full-circle sweep, hits all around" },
  { name: "Dash kick", keys: "tap a direction twice, then K", desc: "Lunging kick" },
  { name: "Low kick", keys: "C + K", desc: "Low-level attack" },
  { name: "Roll", keys: "Shift + C + a direction", desc: "Dodge roll, untouchable at the start, short cooldown" },
  { name: "Weapon toss", keys: "J + K while armed", desc: "Throws the held weapon for 90 damage at long range; it lands on the ground" },
];

function keyMask(keys: Set<string>): InputMask {
  let mask=0;
  for (const k of keys) mask|=KEY_BITS[k] ?? 0;
  return mask;
}

function lerp(a: number, b: number, t: number): number {
  return a+(b-a)*t;
}

// World pixels to a side-scroller screen space with shallow depth (before the camera offset)
function isoX(x: number): number {
  return x*0.5;
}

function isoY(y: number): number {
  return y*0.2;
}

function line(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

// Middle joint of a two-segment limb from a to b; it bends toward the (bx, by) side and straightens as the limb extends
function joint(a: Pt, b: Pt, half: number, bx: number, by: number): Pt {
  const dx=b.x-a.x;
  const dy=b.y-a.y;
  const d=Math.hypot(dx, dy)||1;
  const h=Math.max(half, d/2);
  const off=Math.sqrt(Math.max(0, h*h-d*d/4));
  const sign=(-dy/d)*bx+(dx/d)*by<0? -1:1;
  return { x: (a.x+b.x)/2+(-dy/d)*off*sign, y: (a.y+b.y)/2+(dx/d)*off*sign };
}

type MoveKind="punch"|"kick"|"heavy"|"low"|"upper"|"spin"|"dash"|"thrust"|"sweep"|"chop"|"toss";

const MOVE_KIND: Record<WorldMoveId, MoveKind>={
  punch: "punch", kick: "kick", heavy: "heavy", lowKick: "low", uppercut: "upper", spin: "spin", dash: "dash",
  wThrust: "thrust", wSweep: "sweep", wChop: "chop", sThrust: "thrust", sSweep: "sweep", sChop: "chop",
  wToss: "toss",
  blink: "dash", burst: "spin", // placeholder poses until the skill animations land
};

// How far the striking limb is extended, 0 (rest) to 1 (full): winds up through startup, peaks in active, retracts in recovery
function attackExt(a: Actor): number {
  if (a.state!=="attack"||a.move===null) return 0;
  const { startup, active, recovery }=WORLD_MOVES[a.move];
  if (a.frame<startup) return 0;
  if (a.frame<startup+active) return lerp(0.4, 1, (a.frame-startup+1)/active);
  return 1-Math.min(1, (a.frame-startup-active)/recovery);
}

// Wind-up pull-back, 0 to 1 over the startup frames and 0 once the strike begins
function windup(a: Actor): number {
  if (a.state!=="attack"||a.move===null) return 0;
  const { startup }=WORLD_MOVES[a.move];
  if (a.frame>=startup) return 0;
  const t=a.frame/startup;
  return t*t*(3-2*t);
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

// Pole end points on screen for the actor's current attack phase
function poleLine(a: Actor, weapon: WeaponKind, grip: Pt, ux: number, uy: number): Pt[] {
  const shape=poleShape(a);
  const cs=Math.cos(shape.swing);
  const sn=Math.sin(shape.swing);
  const rx=ux*cs-uy*sn;
  const ry=ux*sn+uy*cs;
  const px=isoX(rx);
  const py=isoY(ry);
  return [
    { x: grip.x-px*POLE_BACK, y: grip.y-py*POLE_BACK },
    { x: grip.x+px*POLE_LEN[weapon]*shape.reach, y: grip.y+py*POLE_LEN[weapon]*shape.reach+shape.tipLift },
  ];
}

// Draws one stick figure in local coordinates: the origin is the actor's foot position on screen
function drawActor(ctx: CanvasRenderingContext2D, a: Actor, sx: number, sy: number, color: string, poleColor: string, fill: string, barBg: string, tick: number, walkAmp: number): void {
  const ux=DIR_COS[a.dir]/256;
  const uy=DIR_SIN[a.dir]/256;
  // Facing direction in screen space, normalised
  const fx0=isoX(ux);
  const fy0=isoY(uy);
  const fl=Math.hypot(fx0, fy0)||1;
  const fx=fx0/fl;
  const fy=fy0/fl;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.lineCap="round";
  ctx.lineJoin="round";
  ctx.lineWidth=4;
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
    ctx.fillStyle=color;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (a.invuln>0&&Math.floor(tick/4)%2===0) ctx.globalAlpha=0.3;

  if (a.state==="roll") {
    // Tucked ball tumbling along the facing direction, with a fading ghost behind
    const spin=a.frame*0.6;
    for (let k=0; k<=2; k++) {
      ctx.globalAlpha=k===0? 1:0.25*(1-k/3);
      const cx=-fx*10*k;
      const cy=-14-fy*5*k;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI*2);
      ctx.stroke();
      line(ctx, [{ x: cx, y: cy }, { x: cx+Math.cos(spin)*9, y: cy+Math.sin(spin)*9 }]);
      if (k===0) {
        ctx.beginPath();
        ctx.arc(cx+Math.cos(spin)*9, cy+Math.sin(spin)*9, HEAD_R*0.7, 0, Math.PI*2);
        ctx.fillStyle=color;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  const kind=a.state==="attack"&&a.move!==null? MOVE_KIND[a.move]:null;
  const e=attackExt(a);
  const w=windup(a);
  const ducking=a.state==="crouch"||kind==="low"||kind==="upper"||a.state==="pickup";
  const running=a.state==="run";

  // Torso: crouching lowers the hips and neck, running and dashing lean forward, a hit leans back
  const hipY=ducking? -HIP_H*0.6:-HIP_H;
  const neckY=ducking? -NECK_H*0.7:-NECK_H;
  let lean=a.state==="hitstun"? -8:running? 7:kind==="dash"? 10*e:kind==="kick"||kind==="heavy"? -6*e:0;
  lean+=(kind==="punch"||kind==="upper"? 6*e:kind==="thrust"||kind==="chop"? 9*e:kind==="sweep"? 5*e:0)-5*w;
  if (a.state==="pickup") lean=10*Math.sin(Math.min(1, a.frame/8)*Math.PI);
  const hip: Pt={ x: 0, y: hipY };
  const neck: Pt={ x: lean*fx, y: neckY+lean*fy*0.5 };
  const head: Pt={ x: neck.x+lean*fx*0.2, y: neck.y-HEAD_R-1 };
  const shoulder: Pt={ x: neck.x, y: neck.y+5 };

  // Default limb swing along the facing direction while moving
  const swing=Math.sin(tick*(running? 0.5:0.3))*(running? 14:9)*walkAmp;
  const stance=a.state==="attack"? 8:5;
  const reach=(len: number): Pt => ({ x: fx*len, y: fy*len*0.5 });
  let footA: Pt=reach(stance+swing);
  let footB: Pt=reach(-(stance+swing));
  let handA: Pt={ x: shoulder.x+fx*(6-swing*0.5), y: shoulder.y+11 };
  let handB: Pt={ x: shoulder.x-fx*(6-swing*0.5), y: shoulder.y+11 };

  if (kind==="toss") {
    // Throwing arm cocks back over the shoulder, then snaps forward and up
    handA={ x: shoulder.x+fx*(8+34*e-14*w), y: shoulder.y-6*e-8*w };
    handB={ x: shoulder.x+fx*5, y: shoulder.y+7 };
  } else if (kind==="punch") {
    handA={ x: shoulder.x+fx*(8+28*e-10*w), y: shoulder.y+4+3*w };
    handB={ x: shoulder.x+fx*5, y: shoulder.y+7 };
  } else if (kind==="upper") {
    handA={ x: shoulder.x+fx*(8+10*e), y: shoulder.y+10-38*e+10*w };
    handB={ x: shoulder.x+fx*4, y: shoulder.y+8 };
  } else if (kind==="kick") {
    footA={ x: fx*(8+34*e-8*w), y: fy*17*e+(hipY+6)*e };
  } else if (kind==="heavy") {
    footA={ x: fx*(6+30*e-8*w), y: fy*15*e+(neckY+12)*e };
  } else if (kind==="low") {
    footA={ x: fx*(10+36*e-8*w), y: fy*18*e-3 };
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
  if (spinning) {
    // Fading copies of the orbiting kick leg
    const m=WORLD_MOVES.spin;
    const th=Math.PI*2*a.frame/(m.startup+m.active+m.recovery);
    for (let k=1; k<=3; k++) {
      ctx.globalAlpha=0.28*(1-k/4);
      const ghost: Pt={ x: Math.cos(th-0.45*k)*34, y: hipY+4+Math.sin(th-0.45*k)*7 };
      line(ctx, [hip, joint(hip, ghost, 14, fx, fy*0.3), ghost]);
    }
    ctx.globalAlpha=1;
  }
  if (e>0&&(kind==="kick"||kind==="heavy"||kind==="low"||kind==="dash")) {
    for (let k=1; k<=3; k++) {
      ctx.globalAlpha=0.28*(1-k/4);
      const s=1-0.18*k;
      const ghost: Pt={ x: footA.x*s, y: hipY+(footA.y-hipY)*s };
      ctx.strokeStyle="#9ca3af";
      line(ctx, [hip, joint(hip, ghost, 14, fx, fy*0.3), ghost]);
    }
    ctx.globalAlpha=1;
    ctx.strokeStyle=color;
  }
  // Legs: knees bend forward, more when crouched
  for (const foot of [footA, footB]) line(ctx, [hip, joint(hip, foot, ducking? 17:14, fx, fy*0.3), foot]);

  line(ctx, [hip, neck]);
  ctx.beginPath();
  ctx.arc(head.x, head.y, HEAD_R, 0, Math.PI*2);
  ctx.fillStyle=color;
  ctx.fill();
  ctx.stroke();

  // Arms: elbows bend down and back
  for (const hand of [handA, handB]) line(ctx, [shoulder, joint(shoulder, hand, 10, -fx*0.6, 1), hand]);

  if (a.state==="pickup") {
    // Hand reaches down toward the ground
    handA={ x: shoulder.x+fx*10, y: -4 };
    line(ctx, [shoulder, handA]);
  }

  // Held weapon: gripped in the lead hand, projected from the facing direction
  if (a.weapon!==null) {
    const weapon=a.weapon;
    const mv=a.move;
    const swinging=a.state==="attack"&&mv!==null&&(kind==="thrust"||kind==="sweep"||kind==="chop");
    if (swinging) {
      // Translucent slash arc and fading copies of the pole behind the swing
      const { startup, active, recovery }=WORLD_MOVES[mv];
      const cur=poleLine(a, weapon, handA, ux, uy);
      let oldest=cur;
      for (let k=1; k<=3; k++) {
        const f=a.frame-k*2;
        if (f<startup||f>=startup+active+recovery*0.3) break;
        const g=poleLine({ ...a, frame: f }, weapon, handA, ux, uy);
        oldest=g;
        ctx.globalAlpha=0.3*(1-k/4);
        ctx.strokeStyle="#9ca3af";
        ctx.lineWidth=3;
        line(ctx, g);
      }
      if (oldest!==cur) {
        ctx.globalAlpha=0.14;
        ctx.fillStyle="#9ca3af";
        ctx.beginPath();
        ctx.moveTo(cur[0].x, cur[0].y);
        ctx.lineTo(cur[1].x, cur[1].y);
        ctx.lineTo(oldest[1].x, oldest[1].y);
        ctx.lineTo(oldest[0].x, oldest[0].y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha=1;
    }
    ctx.strokeStyle=poleColor;
    ctx.lineWidth=3;
    line(ctx, poleLine(a, weapon, handA, ux, uy));
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
  const half=ITEM_HALF_LEN[item.kind];
  const tail=scr(cx-half, cy);
  const tip=scr(cx+half, cy);
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

// Position blended between the previous and current sim step; big jumps (respawn) are not interpolated
function blend(prev: Actor, cur: Actor, alpha: number): Actor {
  if (Math.abs(cur.x-prev.x)>80*SUB||Math.abs(cur.y-prev.y)>80*SUB) return cur;
  return { ...cur, x: lerp(prev.x, cur.x, alpha), y: lerp(prev.y, cur.y, alpha) };
}

function drawScene(ctx: CanvasRenderingContext2D, world: WorldState, prev: WorldState, alpha: number, dark: boolean, amps: number[]): void {
  ctx.fillStyle=dark? "#3a3a3a":"#fbfaf5";
  ctx.fillRect(0, 0, W, H);

  const player=blend(prev.player, world.player, alpha);
  const general=blend(prev.general, world.general, alpha);
  // Camera follows the interpolated player position
  const camX=isoX(player.x/SUB)-W/2;
  const camY=isoY(player.y/SUB)-H/2;
  const scr=(x: number, y: number): Pt => ({ x: isoX(x)-camX, y: isoY(y)-camY });

  // Paper-grid lattice over the world bounds
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
    { a: player, color: dark? "#93c5fd":"#1d4ed8", fill: "#16a34a", amp: amps[0] },
    { a: general, color: dark? "#f87171":"#dc2626", fill: "#ea580c", amp: amps[1] },
  ].sort((p, q) => p.a.y-q.a.y);
  for (const { a, color, fill, amp } of entries) {
    const s=scr(a.x/SUB, a.y/SUB);
    drawActor(ctx, a, s.x, s.y, color, poleColor, fill, barBg, world.tick+alpha, amp);
  }
}

const ARCHETYPE_LABELS: Record<Archetype, string>={ aggressive: "Aggressive", defensive: "Defensive", combo: "Combo", weapon: "Weapon" };
const LEVEL_LABELS: Record<Level, string>={ easy: "Easy", normal: "Normal", hard: "Hard" };
const SELECT_CLASS="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100";

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
  const pausedRef=useRef(false);
  const brainRef=useRef<FighterBrain|null>(null);
  const brainNpcRef=useRef<BrainNpcState>(createBrainNpc());
  const [archetype, setArchetype]=useState<Archetype|"scripted">("scripted");
  const [level, setLevel]=useState<Level>("normal");
  const [brainError, setBrainError]=useState(false);
  const [paused, setPaused]=useState(false);

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
    let prev=worldRef.current;
    const amps=[0, 0];
    const frame=(now: number): void => {
      raf=requestAnimationFrame(frame);
      if (document.hidden) {
        last=null;
        return;
      }
      if (pausedRef.current) {
        last=null;
        drawScene(ctx, worldRef.current, worldRef.current, 0, darkRef.current, amps);
        return;
      }
      if (last===null) last=now;
      acc+=Math.min(now-last, MAX_FRAME_MS);
      last=now;
      while (acc>=STEP_MS) {
        const world=worldRef.current;
        prev=world;
        const brain=brainRef.current;
        let mask: InputMask;
        if (brain!==null) {
          const [m, next]=npcStepBrain(brainNpcRef.current, world, brain, { epsilon: defaultEpsilon(brain) });
          brainNpcRef.current=next;
          mask=m;
        } else {
          const [m, npc]=npcStepWorld(npcRef.current, world);
          npcRef.current=npc;
          mask=m;
        }
        worldRef.current=stepWorld(world, [keyMask(keysRef.current)|touchRef.current, mask]);
        acc-=STEP_MS;
      }
      // Ease the limb swing in and out so it does not snap when movement starts or stops
      const cur=worldRef.current;
      [cur.player, cur.general].forEach((a, i) => {
        const moving=a.state==="run"||a.state==="walk";
        amps[i]=lerp(amps[i], moving? 1:0, 0.2);
      });
      drawScene(ctx, cur, prev, acc/STEP_MS, darkRef.current, amps);
    };
    raf=requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", applyDpr);
      mq.removeEventListener("change", onScheme);
    };
  }, []);

  // Load the chosen soldier brain and restart the fight; "scripted" keeps the built-in level-1 NPC
  useEffect(() => {
    let cancelled=false;
    const restart=(brain: FighterBrain|null): void => {
      const fresh=createWorldSession(1);
      worldRef.current=fresh.world;
      npcRef.current=fresh.npc;
      brainNpcRef.current=createBrainNpc();
      brainRef.current=brain;
      canvasRef.current?.focus({ preventScroll: true });
    };
    if (archetype==="scripted") {
      restart(null);
      return;
    }
    fetch(`/brains/fighter-${archetype}-${level}.json`)
      .then((res) => (res.ok? res.json():null))
      .then((data: unknown) => {
        if (cancelled) return;
        const brain=parseFighterBrain(data);
        setBrainError(brain===null);
        restart(brain);
      })
      .catch(() => {
        if (cancelled) return;
        setBrainError(true);
        restart(null);
      });
    return () => { cancelled=true; };
  }, [archetype, level]);

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
    const setPause=(v: boolean): void => {
      pausedRef.current=v;
      setPaused(v);
    };
    const onBlur=(): void => {
      keys.clear();
      touchRef.current=0;
      setPause(true);
    };
    const onFocus=(): void => setPause(false);
    canvas?.addEventListener("blur", onBlur);
    canvas?.addEventListener("focus", onFocus);
    canvas?.focus({ preventScroll: true });
    setPause(document.activeElement!==canvas);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      canvas?.removeEventListener("blur", onBlur);
      canvas?.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <div className="flex w-full max-w-[800px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-300">
        <label className="flex items-center gap-2">
          Soldier
          <select
            className={SELECT_CLASS}
            value={archetype}
            onChange={(e) => {
              setBrainError(false);
              setArchetype(e.target.value==="scripted"? "scripted":ARCHETYPES.find((a) => a===e.target.value) ?? "scripted");
            }}
          >
            <option value="scripted">Classic (scripted)</option>
            {ARCHETYPES.map((a) => <option key={a} value={a}>{ARCHETYPE_LABELS[a]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Level
          <select
            className={SELECT_CLASS}
            value={level}
            disabled={archetype==="scripted"}
            onChange={(e) => setLevel(LEVELS.find((l) => l===e.target.value) ?? "normal")}
          >
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
          </select>
        </label>
        {brainError&&<span className="text-amber-400">Brain failed to load, using the classic soldier.</span>}
      </div>
      <div className="relative">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        tabIndex={0}
        role="application"
        aria-label="Stick fighter open world. Click to focus, then WASD or arrows move; J punch, K kick, L heavy; Shift run; C crouch; E pick up or drop."
        className="aspect-video w-full rounded-xl border border-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      />
      {paused&&(
        <button
          type="button"
          onClick={() => canvasRef.current?.focus()}
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 text-lg font-medium text-white"
        >
          Paused — click to resume
        </button>
      )}
      </div>
      <TouchControls
        onChange={onTouch}
        moveLabels={{ left: "Left", right: "Right", up: "Up", down: "Down" }}
        attackLabels={["Punch", "Kick", "Heavy"]}
        extraButtons={TOUCH_EXTRAS}
      />
      <p className="text-center text-xs text-neutral-400">
        Click the game, then WASD or arrows move · Shift run · C crouch · E pick up / drop · J punch · K kick · L heavy
      </p>
      <div className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500">Skills</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SKILLS.map((skill) => (
            <li key={skill.name} className="rounded-lg border border-neutral-800 px-3 py-2 text-xs">
              <span className="font-medium text-neutral-200">{skill.name}</span>
              {" "}
              <span className="font-mono text-violet-300">{skill.keys}</span>
              <p className="text-neutral-400">{skill.desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
