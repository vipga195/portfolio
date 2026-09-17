"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { PROFILE } from "@/data/profile";

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

export default function Hero(): React.JSX.Element {
  const container = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".hero-item", { y: 40, opacity: 0, duration: 0.9, stagger: 0.12, ease: "power3.out" });
      });
    },
    { scope: container },
  );

  return (
    <section ref={container} className="relative flex min-h-svh items-center overflow-hidden">
      <div className="absolute inset-0 -z-10 opacity-70">
        <HeroScene />
      </div>
      <div className="mx-auto w-full max-w-5xl px-6">
        <p className="hero-item font-mono text-sm text-blue-400">Hi, I&apos;m</p>
        <h1 className="hero-item mt-2 text-5xl font-bold tracking-tight md:text-7xl">{PROFILE.name}</h1>
        <h2 className="hero-item mt-3 text-2xl text-neutral-400 md:text-3xl">{PROFILE.title}</h2>
        <p className="hero-item mt-6 max-w-xl text-lg text-neutral-300">{PROFILE.tagline}</p>
        <div className="hero-item mt-8 flex flex-wrap gap-4">
          <a href="#projects" className="rounded-full bg-blue-500 px-6 py-3 font-medium text-white hover:bg-blue-400">
            View work
          </a>
          <a
            href={PROFILE.cvUrl}
            className="rounded-full border border-neutral-600 px-6 py-3 font-medium hover:border-neutral-300"
          >
            Download CV
          </a>
        </div>
      </div>
    </section>
  );
}
