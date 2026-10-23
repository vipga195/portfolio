"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import TouchControls from "@/components/games/TouchControls";
import { MAX_HP, MOVES, ROUND_FRAMES, SUB } from "@/lib/game/fighter/frame-data";
import type { MoveId } from "@/lib/game/fighter/frame-data";
import { BIT } from "@/lib/game/fighter/inputs";
import type { InputMask } from "@/lib/game/fighter/inputs";
import { createNpc, npcStep } from "@/lib/game/fighter/npc";
import type { NpcLevel, NpcState } from "@/lib/game/fighter/npc";
import { createFight, stepFight } from "@/lib/game/fighter/sim";
import type { Fighter, FightState } from "@/lib/game/fighter/sim";

const W=800;
const H=450;
const GROUND_Y=380;
const STEP_MS=1000/60;
const MAX_FRAME_MS=250;
const FPS=60;

const PLAYER_COLOR="#16a34a";
const NPC_COLOR="#ea580c";

const HIP_STAND=38;
const HIP_CROUCH=20;
const TORSO=34;
const HEAD_R=9;
const POLE_BACK=30;
const POLE_FRONT=100;
const HAND_GAP=35;

type Status="ready"|"fighting"|"over";
type Result="win"|"lose"|"draw";
type Pt={ x: number; y: number };
type Key={ a: number; reach: number; lift: number };
type Effect={ x: number; y: number; born: number; ttl: number; kind: "hit"|"block" };

const KEY_BITS: Record<string, number>={
  a: BIT.LEFT, arrowleft: BIT.LEFT,
  d: BIT.RIGHT, arrowright: BIT.RIGHT,
  w: BIT.UP, arrowup: BIT.UP,
  s: BIT.DOWN, arrowdown: BIT.DOWN,
  j: BIT.THRUST, k: BIT.SWEEP, l: BIT.CHOP,
};

const LEVELS: { level: NpcLevel; label: string }[]=[
  { level: 1, label: "Easy" },
  { level: 2, label: "Normal" },
  { level: 3, label: "Hard" },
];

// Pole pose keys: [rest, end of startup, end of active]; angle in degrees above the forward horizontal
const IDLE_KEY: Key={ a: 35, reach: 0, lift: 0 };
const MOVE_KEYS: Record<MoveId, [Key, Key]>={
  thrust: [{ a: 8, reach: -14, lift: 0 }, { a: 0, reach: 36, lift: -2 }],
  sweep: [{ a: 80, reach: -6, lift: 6 }, { a: -40, reach: 14, lift: -4 }],
  chop: [{ a: 140, reach: -4, lift: 34 }, { a: -75, reach: 20, lift: -6 }],
  lowSweep: [{ a: 30, reach: -6, lift: -2 }, { a: -12, reach: 16, lift: -6 }],
};

function lerp(a: number, b: number, t: number): number {
  return a+(b-a)*t;
}

function lerpKey(a: Key, b: Key, t: number): Key {
  return { a: lerp(a.a, b.a, t), reach: lerp(a.reach, b.reach, t), lift: lerp(a.lift, b.lift, t) };
}

function keyMask(keys: Set<string>): InputMask {
  let mask=0;
  for (const k of keys) mask|=KEY_BITS[k] ?? 0;
  return mask;
}

type PoleInfo={ key: Key; move: MoveId|null; phase: "startup"|"active"|"recovery"|null; from: Key|null };

function poleInfo(f: Fighter): PoleInfo {
  if (f.state==="attack"&&f.move!==null) {
    const { startup, active, recovery }=MOVES[f.move];
    const [cocked, extended]=MOVE_KEYS[f.move];
    if (f.frame<startup) return { key: lerpKey(IDLE_KEY, cocked, f.frame/startup), move: f.move, phase: "startup", from: null };
    if (f.frame<startup+active) {
      return { key: lerpKey(cocked, extended, (f.frame-startup+1)/active), move: f.move, phase: "active", from: cocked };
    }
    return { key: lerpKey(extended, IDLE_KEY, Math.min(1, (f.frame-startup-active)/recovery)), move: f.move, phase: "recovery", from: null };
  }
  if (f.state==="blockstun") return { key: { a: 80, reach: 10, lift: 8 }, move: null, phase: null, from: null };
  if (f.state==="hitstun") return { key: { a: 60, reach: -8, lift: 0 }, move: null, phase: null, from: null };
  return { key: IDLE_KEY, move: null, phase: null, from: null };
}

function line(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawTrail(ctx: CanvasRenderingContext2D, info: PoleInfo, base: Pt, dir: number): void {
  if (info.phase!=="active"||info.from===null||info.move===null) return;
  ctx.save();
  ctx.fillStyle="rgba(120,120,120,0.35)";
  if (info.move==="thrust") {
    const rad=info.key.a*Math.PI/180;
    const ux=dir*Math.cos(rad);
    const uy=-Math.sin(rad);
    ctx.strokeStyle="rgba(120,120,120,0.35)";
    ctx.lineWidth=12;
    ctx.lineCap="round";
    line(ctx, [{ x: base.x+ux*HAND_GAP, y: base.y+uy*HAND_GAP }, { x: base.x+ux*POLE_FRONT, y: base.y+uy*POLE_FRONT }]);
    ctx.restore();
    return;
  }
  const steps=10;
  const a0=info.from.a;
  const a1=info.key.a;
  const outer: Pt[]=[];
  const inner: Pt[]=[];
  for (let i=0; i<=steps; i++) {
    const rad=lerp(a0, a1, i/steps)*Math.PI/180;
    const ux=dir*Math.cos(rad);
    const uy=-Math.sin(rad);
    outer.push({ x: base.x+ux*POLE_FRONT, y: base.y+uy*POLE_FRONT });
    inner.push({ x: base.x+ux*55, y: base.y+uy*55 });
  }
  const poly=[...outer, ...inner.reverse()];
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i=1; i<poly.length; i++) ctx.lineTo(poly[i].x, Math.min(poly[i].y, GROUND_Y));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFighter(ctx: CanvasRenderingContext2D, f: Fighter, color: string, poleColor: string, t: number): void {
  const dir=f.facing;
  const px=f.x/SUB;
  const base=GROUND_Y-f.y/SUB;
  const info=poleInfo(f);
  const key=info.key;

  ctx.lineCap="round";
  ctx.lineJoin="round";
  ctx.strokeStyle=color;
  ctx.fillStyle=color;
  ctx.lineWidth=3;

  let polePts: [Pt, Pt]|null=null;

  if (f.state==="knockdown") {
    const y=base-6;
    const neck: Pt={ x: px-dir*34, y };
    ctx.beginPath();
    ctx.arc(px-dir*45, y-2, HEAD_R, 0, Math.PI*2);
    ctx.stroke();
    line(ctx, [{ x: px, y }, neck]);
    line(ctx, [{ x: px, y }, { x: px+dir*16, y: y-6 }, { x: px+dir*32, y: y+2 }]);
    line(ctx, [{ x: px, y }, { x: px+dir*18, y: y+2 }, { x: px+dir*36, y: y+3 }]);
    line(ctx, [{ x: px-dir*24, y }, { x: px-dir*8, y: y-8 }]);
    polePts=[{ x: px-dir*70, y: base-3 }, { x: px+dir*70, y: base-3 }];
  } else {
    let hipH=HIP_STAND;
    let lean=0;
    let bend=6;
    const crouched=f.state==="crouch"||(f.state==="attack"&&f.move==="lowSweep");
    if (crouched) {
      hipH=HIP_CROUCH;
      bend=12;
    }
    if (f.state==="getup") {
      const p=f.stun>0? f.frame/f.stun:1;
      hipH=lerp(HIP_CROUCH-2, HIP_STAND, p);
      lean=-6*(1-p);
      bend=12*(1-p)+6*p;
    }
    if (f.state==="attack"&&info.phase==="active") lean=10;
    else if (f.state==="attack"&&info.phase==="startup") lean=-3;
    if (f.state==="hitstun") lean=-12;
    if (f.state==="blockstun") lean=-4;

    const hip: Pt={ x: px, y: base-hipH };
    const neck: Pt={ x: hip.x+dir*lean, y: hip.y-TORSO };
    const head: Pt={ x: neck.x+dir*lean*0.3, y: neck.y-HEAD_R-1 };
    const shoulder: Pt={ x: neck.x, y: neck.y+4 };

    // Legs: front/back foot position per state
    let ff: Pt;
    let bf: Pt;
    if (f.y>0) {
      ff={ x: px+dir*12, y: hip.y+22 };
      bf={ x: px-dir*8, y: hip.y+26 };
    } else if (f.state==="walk") {
      const s=Math.sin(t*0.3)*12;
      const lift=Math.max(0, Math.cos(t*0.3))*4;
      ff={ x: px+dir*s, y: base-lift };
      bf={ x: px-dir*s, y: base-Math.max(0, -Math.cos(t*0.3))*4 };
    } else if (crouched||f.state==="getup") {
      ff={ x: px+dir*16, y: base };
      bf={ x: px-dir*14, y: base };
    } else if (f.state==="attack") {
      ff={ x: px+dir*16, y: base };
      bf={ x: px-dir*14, y: base };
    } else {
      ff={ x: px+dir*9, y: base };
      bf={ x: px-dir*9, y: base };
    }
    for (const foot of [ff, bf]) {
      const mid: Pt={ x: (hip.x+foot.x)/2+dir*bend, y: (hip.y+foot.y)/2 };
      line(ctx, [hip, mid, foot]);
    }

    line(ctx, [hip, neck]);
    ctx.beginPath();
    ctx.arc(head.x, head.y, HEAD_R, 0, Math.PI*2);
    ctx.stroke();

    // Arms and pole: the rear hand is the pole's pivot
    const rear: Pt={ x: shoulder.x+dir*(12+key.reach), y: shoulder.y+10-key.lift };
    const rad=key.a*Math.PI/180;
    const ux=dir*Math.cos(rad);
    const uy=-Math.sin(rad);
    const front: Pt={ x: rear.x+ux*HAND_GAP, y: rear.y+uy*HAND_GAP };
    line(ctx, [shoulder, rear]);
    line(ctx, [shoulder, front]);
    polePts=[{ x: rear.x-ux*POLE_BACK, y: rear.y-uy*POLE_BACK }, { x: rear.x+ux*POLE_FRONT, y: rear.y+uy*POLE_FRONT }];
    drawTrail(ctx, info, rear, dir);
  }

  if (polePts) {
    ctx.strokeStyle=poleColor;
    ctx.lineWidth=5;
    line(ctx, polePts);
    // Small blade at the tip
    const [a, b]=polePts;
    const len=Math.hypot(b.x-a.x, b.y-a.y)||1;
    ctx.lineWidth=7;
    line(ctx, [{ x: b.x-(b.x-a.x)/len*10, y: b.y-(b.y-a.y)/len*10 }, b]);
  }
}

function drawEffect(ctx: CanvasRenderingContext2D, e: Effect, now: number): void {
  const t=(now-e.born)/e.ttl;
  if (t<0||t>=1) return;
  ctx.save();
  ctx.globalAlpha=1-t;
  if (e.kind==="block") {
    ctx.strokeStyle="#38bdf8";
    ctx.lineWidth=3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 8+t*22, 0, Math.PI*2);
    ctx.stroke();
    ctx.strokeStyle="#ffffff";
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 4+t*12, 0, Math.PI*2);
    ctx.stroke();
  } else {
    ctx.fillStyle="#a8a29e";
    for (let i=0; i<6; i++) {
      const ang=i/6*Math.PI*2+0.4;
      const r=4+t*22;
      ctx.beginPath();
      ctx.arc(e.x+Math.cos(ang)*r, e.y+Math.sin(ang)*r-t*8, 6*(1-t*0.6), 0, Math.PI*2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, fight: FightState, effects: Effect[], dark: boolean, now: number): void {
  ctx.fillStyle=dark? "#3a3a3a":"#fbfaf5";
  ctx.fillRect(0, 0, W, H);

  // Lined notebook paper
  ctx.strokeStyle=dark? "rgba(255,255,255,0.14)":"rgba(96,165,250,0.35)";
  ctx.lineWidth=1;
  for (let y=40; y<H; y+=30) {
    ctx.beginPath();
    ctx.moveTo(0, y+0.5);
    ctx.lineTo(W, y+0.5);
    ctx.stroke();
  }

  // Ground
  ctx.strokeStyle=dark? "#e5e5e5":"#1f2937";
  ctx.lineWidth=3;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y+1.5);
  ctx.lineTo(W, GROUND_Y+1.5);
  ctx.stroke();

  const poleColor=dark? "#d4d4d4":"#0a0a0a";
  drawFighter(ctx, fight.fighters[0], PLAYER_COLOR, poleColor, fight.tick);
  drawFighter(ctx, fight.fighters[1], NPC_COLOR, poleColor, fight.tick);
  for (const e of effects) drawEffect(ctx, e, now);
}

function isTypingTarget(target: EventTarget|null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable||["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function FighterGame(): React.JSX.Element {
  const [status, setStatus]=useState<Status>("ready");
  const [result, setResult]=useState<Result|null>(null);
  const [hp, setHp]=useState<[number, number]>([MAX_HP, MAX_HP]);
  const [level, setLevel]=useState<NpcLevel>(2);

  const canvasRef=useRef<HTMLCanvasElement>(null);
  const containerRef=useRef<HTMLDivElement>(null);
  const timerRef=useRef<HTMLSpanElement>(null);

  const statusRef=useRef<Status>("ready");
  const levelRef=useRef<NpcLevel>(2);
  const fightRef=useRef<FightState>(createFight(1));
  const npcRef=useRef<NpcState>(createNpc(2, 1));
  const keysRef=useRef<Set<string>>(new Set());
  const touchRef=useRef<InputMask>(0);
  const effectsRef=useRef<Effect[]>([]);
  const darkRef=useRef(false);

  const startRound=useCallback((): void => {
    const seed=(Date.now()&0xffffffff)>>>0;
    fightRef.current=createFight(1);
    npcRef.current=createNpc(levelRef.current, seed);
    effectsRef.current=[];
    statusRef.current="fighting";
    if (timerRef.current) timerRef.current.textContent=String(Math.ceil(ROUND_FRAMES/FPS));
    setHp([MAX_HP, MAX_HP]);
    setResult(null);
    setStatus("fighting");
    containerRef.current?.focus();
  }, []);

  const changeLevel=(next: NpcLevel): void => {
    levelRef.current=next;
    setLevel(next);
  };

  const onTouch=useCallback((mask: InputMask): void => {
    touchRef.current=mask;
  }, []);

  // Game loop: fixed 60 Hz steps inside requestAnimationFrame
  useEffect(() => {
    const canvas=canvasRef.current;
    const ctx=canvas?.getContext("2d");
    if (!canvas||!ctx) return;
    const dpr=Math.min(window.devicePixelRatio||1, 2);
    canvas.width=W*dpr;
    canvas.height=H*dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const mq=window.matchMedia("(prefers-color-scheme: dark)");
    darkRef.current=mq.matches;
    const onScheme=(): void => { darkRef.current=mq.matches; };
    mq.addEventListener("change", onScheme);

    const tick=(): void => {
      const fight=fightRef.current;
      const p1=keyMask(keysRef.current)|touchRef.current;
      const [p2, npc]=npcStep(npcRef.current, fight, 1);
      npcRef.current=npc;
      const next=stepFight(fight, [p1, p2]);
      const now=performance.now();

      // Purely visual: spawn an effect where a fighter lost HP this step
      for (let i=0; i<2; i++) {
        const before=fight.fighters[i];
        const after=next.fighters[i];
        if (after.hp<before.hp) {
          effectsRef.current.push({
            x: after.x/SUB,
            y: GROUND_Y-after.y/SUB-55,
            born: now,
            ttl: after.state==="blockstun"? 250:350,
            kind: after.state==="blockstun"? "block":"hit",
          });
        }
      }

      fightRef.current=next;
      const secs=Math.max(0, Math.ceil((ROUND_FRAMES-next.tick)/FPS));
      if (timerRef.current&&timerRef.current.textContent!==String(secs)) timerRef.current.textContent=String(secs);

      const [a, b]=next.fighters;
      if (a.hp!==fight.fighters[0].hp||b.hp!==fight.fighters[1].hp) setHp([a.hp, b.hp]);
      if (next.winner!==null) {
        statusRef.current="over";
        setResult(next.winner===1? "win":next.winner===2? "lose":"draw");
        setStatus("over");
      }
    };

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
      const dt=Math.min(now-last, MAX_FRAME_MS);
      last=now;
      if (statusRef.current==="fighting") {
        acc+=dt;
        while (acc>=STEP_MS&&statusRef.current==="fighting") {
          tick();
          acc-=STEP_MS;
        }
      } else {
        acc=0;
      }
      effectsRef.current=effectsRef.current.filter((e) => now-e.born<e.ttl);
      drawScene(ctx, fightRef.current, effectsRef.current, darkRef.current, now);
    };
    raf=requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      mq.removeEventListener("change", onScheme);
    };
  }, []);

  // Keyboard
  useEffect(() => {
    const keys=keysRef.current;
    const onDown=(e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return;
      const k=e.key.toLowerCase();
      if (KEY_BITS[k]!==undefined) {
        const focused=containerRef.current?.contains(document.activeElement)===true;
        if (statusRef.current==="fighting"||focused) e.preventDefault();
        keys.add(k);
      }
      const startKey=(e.key.length===1&&e.key!==" ")||e.key.startsWith("Arrow");
      if (statusRef.current==="ready"&&startKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey) {
        e.preventDefault();
        startRound();
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
  }, [startRound]);

  const resultText=result==="win"? "You win":result==="lose"? "CPU wins":"Draw";
  const buttonClass="rounded-full bg-blue-600 px-6 py-2 font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";

  return (
    <div ref={containerRef} tabIndex={-1} className="flex w-full max-w-[800px] flex-col gap-4 outline-none">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-semibold tracking-wide">YOU</span>
          <div className="h-4 overflow-hidden rounded-full bg-neutral-500/30" role="progressbar" aria-label="Your health" aria-valuemin={0} aria-valuemax={MAX_HP} aria-valuenow={hp[0]}>
            <div className="h-full bg-[#16a34a] transition-[width] duration-100" style={{ width: `${hp[0]/MAX_HP*100}%` }} />
          </div>
        </div>
        <span ref={timerRef} className="w-10 text-center text-xl font-bold tabular-nums">{Math.ceil(ROUND_FRAMES/FPS)}</span>
        <div className="flex flex-1 flex-col items-end gap-1">
          <span className="text-xs font-semibold tracking-wide">CPU</span>
          <div className="flex h-4 w-full justify-end overflow-hidden rounded-full bg-neutral-500/30" role="progressbar" aria-label="CPU health" aria-valuemin={0} aria-valuemax={MAX_HP} aria-valuenow={hp[1]}>
            <div className="h-full bg-[#ea580c] transition-[width] duration-100" style={{ width: `${hp[1]/MAX_HP*100}%` }} />
          </div>
        </div>
      </div>

      {status!=="fighting"&&(
        <div className="flex items-center justify-center gap-2" role="group" aria-label="Difficulty">
          {LEVELS.map((l) => (
            <button
              key={l.level}
              type="button"
              onClick={() => changeLevel(l.level)}
              aria-pressed={level===l.level}
              className={`rounded-full border border-neutral-500 px-4 py-1 text-sm ${level===l.level? "bg-neutral-500/60 font-semibold":"bg-transparent"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="relative w-full">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="aspect-video w-full rounded-xl border border-neutral-800"
        />
        {status!=="fighting"&&(
          <div className="absolute inset-0 grid place-items-center rounded-xl bg-black/50">
            <div className="text-center text-white">
              {status==="over"&&<p className="mb-3 text-2xl font-semibold">{resultText}</p>}
              {status==="ready"&&<p className="mb-3 text-lg">Press any key or tap Start</p>}
              <button type="button" onClick={startRound} className={buttonClass}>
                {status==="over"? "Play again":"Start"}
              </button>
            </div>
          </div>
        )}
      </div>

      <TouchControls onChange={onTouch} />

      <p className="text-center text-xs text-neutral-400">
        A/D or arrows move · W jump · S crouch · J thrust · K sweep (hold S for low sweep) · L chop · hold the direction away from the CPU to block
      </p>
    </div>
  );
}
