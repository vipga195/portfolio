"use client";

import { useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { getIntroPhase, setIntroPhase } from "@/lib/intro";

gsap.registerPlugin(useGSAP);

const SPREAD_DURATION = 1.8;
const SURGE_HEIGHT = 0.18;
const SURGE_TAPER = 0.1;
const LAYER_LAG = 0.12;
// Overshoot so every layer's tapered leading edge fully passes the right wall before rising
const SPREAD_END = 1 + SURGE_TAPER + LAYER_LAG;
const PRELOAD_TARGET = 0.9;
const PRELOAD_DURATION = 2.6;
const FINISH_DURATION = 1;
const FADE_DURATION = 1.4;
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
  { offset: 0.35, amp: 0.8, fill: () => "rgba(59, 130, 246, 0.35)" },
  {
    offset: 0,
    amp: 1,
    fill: (ctx, height) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#3b82f6");
      gradient.addColorStop(1, "#2563eb");
      return gradient;
    },
  },
];

// Crest position ping-pongs 0 -> 1 -> 0 with eased turnarounds, like water hitting a wall
function crestPosition(time: number): { pos: number; dir: number } {
  const u = (time / WAVE_TRAVEL) % 2;
  const linear = u < 1 ? u : 2 - u;
  const eased = linear * linear * (3 - 2 * linear);
  return { pos: eased, dir: u < 1 ? 1 : -1 };
}

export default function Loader(): React.JSX.Element | null {
  const root = useRef<HTMLDivElement>(null);
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
          ctx.beginPath();
          ctx.moveTo(0, height);
          for (let i = 0; i <= SEGMENTS; i++) {
            const nx = (i / SEGMENTS) * front;
            const bump = Math.exp(-(((nx - crest) / WAVE_WIDTH) ** 2)) * WAVE_AMP;
            const ripple = Math.sin(nx * Math.PI * 3 - ripplePhase * Math.PI + offset * 4) * RIPPLE_AMP;
            const tilt = rising ? (nx - 0.5) * (pos - 0.5) * 2 * TILT_AMP : 0;
            const surface = level - (bump + ripple + tilt) * height * energy * amp;
            // Leading edge of the surge tapers down to the floor
            const edge = Math.min((head - nx) / SURGE_TAPER, 1);
            const taper = edge * edge * (3 - 2 * edge);
            ctx.lineTo(nx * width, height - (height - surface) * taper);
          }
          ctx.lineTo(front * width, height);
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
      tl.to(spread, { value: SPREAD_END, duration: SPREAD_DURATION, ease: "power1.inOut" })
        .to(progress, { value: PRELOAD_TARGET, duration: PRELOAD_DURATION, ease: "power1.inOut" })
        .call(() => {
          if (!pageLoaded) tl.pause();
        })
        .to(progress, { value: 1, duration: FINISH_DURATION, ease: "power2.out" })
        .call(() => setIntroPhase("revealing"))
        .to(root.current, {
          opacity: 0,
          duration: FADE_DURATION,
          ease: "power2.inOut",
          onComplete: () => setVisible(false),
        });

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
      <div className="relative size-[min(70vw,20rem)] overflow-hidden rounded-full border-4 border-blue-500">
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="text-3xl font-semibold tracking-[0.3em] text-neutral-200 uppercase">huy.dev</span>
          <span ref={label} className="font-mono text-sm text-neutral-100">
            0%
          </span>
        </div>
      </div>
    </div>
  );
}
