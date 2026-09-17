"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import { getIntroPhase, setIntroPhase, subscribeIntro } from "@/lib/intro";
import type { IntroState } from "./HeroScene";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

const HERO_SELECTOR = "#hero";
const MAX_OPACITY = 0.7;
// Hold the full-screen monogram while particles assemble, then shrink slowly into place
const SETTLE_DELAY = 2.8;
const SETTLE_DURATION = 2.6;

export default function HeroBackground(): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const intro = useRef<IntroState>(
    getIntroPhase() === "loading" ? { active: false, settle: 0 } : { active: true, settle: 1 },
  );

  useGSAP(() => {
    gsap.fromTo(
      container.current,
      { opacity: MAX_OPACITY },
      {
        opacity: 0,
        ease: "none",
        scrollTrigger: {
          trigger: HERO_SELECTOR,
          start: "top top",
          end: "bottom top",
          scrub: true,
          onLeave: () => setPaused(true),
          onEnterBack: () => setPaused(false),
        },
      },
    );

    const reveal = (): void => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      intro.current.active = true;
      gsap.to(intro.current, {
        settle: 1,
        delay: reducedMotion ? 0 : SETTLE_DELAY,
        duration: reducedMotion ? 0 : SETTLE_DURATION,
        ease: "power2.inOut",
        onComplete: () => setIntroPhase("settled"),
      });
    };
    return subscribeIntro((phase) => {
      if (phase === "revealing") reveal();
    });
  });

  return (
    <div ref={container} aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <HeroScene paused={paused} intro={intro} />
    </div>
  );
}
