"use client";

import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { BACKDROP_FADE, BURST_DURATION, getIntroPhase, setIntroBurst, setIntroPhase } from "@/lib/intro";

gsap.registerPlugin(useGSAP);

const SPREAD_DURATION = 3.6;
const SURGE_HEIGHT = 0.18;
const CURL_BUMP = 0.14;
const CURL_WIDTH = 0.18;
const LIP_SIZE = 1.4;
const FACE_SLANT = 0.06;
// Head positions (0..1 of width): crest rises, lip rolls out, then both settle before touching the right wall
const CREST_GROW: readonly [number, number] = [0, 0.2];
const LIP_GROW: readonly [number, number] = [0.08, 0.35];
const CURL_COLLAPSE: readonly [number, number] = [0.78, 0.98];
const LAYER_LAG = 0.12;
const SPREAD_END = 1 + LAYER_LAG;
const PRELOAD_TARGET = 0.9;
const PRELOAD_DURATION = 2.6;
const FINISH_DURATION = 1;
const POP_DURATION = 0.2;
const POP_SCALE = 1.08;
const WAVE_TRAVEL = 2.8;
const WAVE_AMP = 0.05;
const WAVE_WIDTH = 0.28;
const RIPPLE_AMP = 0.035;
const RIPPLE_SPEED = 2.2;
const TILT_AMP = 0.02;
const SEGMENTS = 64;

type Layer = {
  offset: number;
  amp: number;
  fill: (ctx: CanvasRenderingContext2D, height: number) => string | CanvasGradient;
};

const LAYERS: Layer[] = [
  { offset: 0.35, amp: 0.8, fill: () => "rgba(139, 92, 246, 0.35)" },
  {
    offset: 0,
    amp: 1,
    fill: (ctx, height) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#3b82f6");
      gradient.addColorStop(1, "#8b5cf6");
      return gradient;
    },
  },
];

function smoothstep([from, to]: readonly [number, number], value: number): number {
  const t = Math.min(Math.max((value - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
}

// Breaking lip: rolls forward and down, hooks back under itself, then a hollow face drops to the floor
function drawCurl(ctx: CanvasRenderingContext2D, px: number, py: number, size: number, floor: number, slant: number): void {
  ctx.bezierCurveTo(px + 0.07 * size, py - 0.01 * size, px + 0.13 * size, py + 0.02 * size, px + 0.12 * size, py + 0.08 * size);
  ctx.quadraticCurveTo(px + 0.11 * size, py + 0.11 * size, px + 0.08 * size, py + 0.1 * size);
  ctx.bezierCurveTo(px + 0.05 * size, py + 0.09 * size, px + 0.03 * size + slant * 0.5, py + 0.18 * size, px + 0.1 * size + slant, floor);
}

// Crest position ping-pongs 0 -> 1 -> 0 with eased turnarounds, like water hitting a wall
function crestPosition(time: number): { pos: number; dir: number } {
  const u = (time / WAVE_TRAVEL) % 2;
  const linear = u < 1 ? u : 2 - u;
  const eased = linear * linear * (3 - 2 * linear);
  return { pos: eased, dir: u < 1 ? 1 : -1 };
}

export default function Loader(): React.JSX.Element | null {
  const root = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => getIntroPhase() === "loading");

  useGSAP(
    () => {
      const el = canvas.current;
      const ctx = el?.getContext("2d");
      if (!el || !ctx) return;

      const spread = { value: 0 };
      const progress = { value: 0 };
      let width = 0;
      let height = 0;
      let riseTime = 0;
      let ripplePhase = 0;

      const resize = (): void => {
        const dpr = Math.min(window.devicePixelRatio, 2);
        width = el.clientWidth;
        height = el.clientHeight;
        el.width = width * dpr;
        el.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      window.addEventListener("resize", resize);

      const draw = (_time: number, deltaMs: number): void => {
        const dt = Math.min(deltaMs / 1000, 1 / 30);
        // Phase 1: surge flows in from the left; phase 2: after hitting the right wall, it bounces back and the level rises
        const rising = spread.value >= SPREAD_END;
        if (rising) riseTime += dt;
        const { pos, dir } = rising ? crestPosition(riseTime + WAVE_TRAVEL) : { pos: spread.value, dir: 1 };
        ripplePhase += dir * dt * RIPPLE_SPEED;

        // Full energy while flowing in, calming down as the screen fills
        const energy = 1 - 0.7 * progress.value ** 2;
        const surge = height * SURGE_HEIGHT;
        const pad = height * WAVE_AMP * 2;
        const level = height - surge - (height - surge + pad) * progress.value;

        ctx.clearRect(0, 0, width, height);
        LAYERS.forEach(({ offset, amp, fill }) => {
          const head = rising ? SPREAD_END : Math.max(spread.value - offset * LAYER_LAG, 0);
          const front = Math.min(head, 1);
          if (front <= 0) return;
          const bounceCrest = crestPosition(riseTime + WAVE_TRAVEL - offset).pos;
          const crest = rising ? bounceCrest : Math.min(front, bounceCrest);
          // Crest and lip grow in while entering, then settle into a plain wave as the lip reaches the right wall
          const collapse = rising ? 0 : 1 - smoothstep(CURL_COLLAPSE, head);
          const crestScale = smoothstep(CREST_GROW, head) * collapse;
          const lipScale = smoothstep(LIP_GROW, head) * collapse;
          const bumpAmp = WAVE_AMP + (CURL_BUMP - WAVE_AMP) * crestScale;
          const bumpWidth = WAVE_WIDTH + (CURL_WIDTH - WAVE_WIDTH) * crestScale;
          // Entering surge rises from the floor instead of sliding in at full height
          const entry = rising ? 1 : smoothstep(CREST_GROW, head);
          ctx.beginPath();
          ctx.moveTo(0, height);
          let surface = height;
          for (let i = 0; i <= SEGMENTS; i++) {
            const nx = (i / SEGMENTS) * front;
            const bump = Math.exp(-(((nx - crest) / bumpWidth) ** 2)) * bumpAmp;
            const ripple = Math.sin(nx * Math.PI * 3 - ripplePhase * Math.PI + offset * 4) * RIPPLE_AMP;
            const tilt = rising ? (nx - 0.5) * (pos - 0.5) * 2 * TILT_AMP : 0;
            surface = height - (height - level + (bump + ripple + tilt) * height * energy * amp) * entry;
            ctx.lineTo(nx * width, surface);
          }
          if (!rising) {
            const px = head * width;
            ctx.lineTo(px, surface);
            const slant = height * FACE_SLANT * (1 - lipScale) * entry;
            drawCurl(ctx, px, surface, height * lipScale * amp * LIP_SIZE, height, slant);
          } else {
            ctx.lineTo(width, height);
          }
          ctx.closePath();
          ctx.fillStyle = fill(ctx, height);
          ctx.fill();
        });

        // Percent mirrors the visible rise above the surge, so the number matches the water level
        const fill = Math.min(Math.max((height - surge - level) / (height - surge), 0), 1);
        if (label.current) label.current.textContent = `${Math.round(fill * 100)}%`;
      };
      gsap.ticker.add(draw);

      let pageLoaded = document.readyState === "complete";
      const tl = gsap.timeline();
      tl.to(spread, { value: SPREAD_END, duration: SPREAD_DURATION, ease: "sine.inOut" })
        .to(progress, { value: PRELOAD_TARGET, duration: PRELOAD_DURATION, ease: "power1.inOut" })
        .call(() => {
          if (!pageLoaded) tl.pause();
        })
        .to(progress, { value: 1, duration: FINISH_DURATION, ease: "power2.out" })
        .call(() => {
          // Hand the ring size to the particle scene so it bursts from the same spot
          setIntroBurst((ring.current?.offsetWidth ?? 0) / 2);
          setIntroPhase("revealing");
        })
        .to(ring.current, { scale: POP_SCALE, opacity: 0, duration: POP_DURATION, ease: "power2.out" })
        .to(
          root.current,
          {
            opacity: 0,
            duration: BACKDROP_FADE,
            ease: "power2.inOut",
            onComplete: () => setVisible(false),
          },
          `<${BURST_DURATION}`,
        );

      const onLoad = (): void => {
        pageLoaded = true;
        if (tl.paused()) tl.play();
      };
      window.addEventListener("load", onLoad, { once: true });

      return () => {
        gsap.ticker.remove(draw);
        window.removeEventListener("resize", resize);
        window.removeEventListener("load", onLoad);
      };
    },
    { dependencies: [visible] },
  );

  if (!visible) return null;

  return (
    <div ref={root} aria-hidden className="fixed inset-0 z-100 flex items-center justify-center bg-neutral-950">
      <div
        ref={ring}
        className="size-[min(70vw,20rem)] rounded-full bg-linear-to-br from-[#3b82f6] to-[#8b5cf6] p-1"
      >
        <div className="relative size-full overflow-hidden rounded-full bg-neutral-950">
          <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span ref={label} className="font-mono text-2xl font-semibold text-[#fbbf24]">
              0%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
