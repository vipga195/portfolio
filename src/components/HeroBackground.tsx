"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

import { BACKDROP_FADE, BURST_DURATION, getIntroBurst, getIntroPhase, setIntroPhase, subscribeIntro } from "@/lib/intro";
import type { IntroState } from "./HeroScene";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

const HERO_SELECTOR = "#hero";
const MAX_OPACITY = 0.7;
// Hold the full-screen monogram while particles assemble, then shrink slowly into place
const SETTLE_DELAY = 2.8;
const SETTLE_DURATION = 2.6;
// Above the loader backdrop (z-100) so only particles show while the page stays hidden
const BURST_Z = 110;

export default function HeroBackground(): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const intro = useRef<IntroState>(
    getIntroPhase() === "loading" ? { active: false, settle: 0, burst: 0 } : { active: true, settle: 1, burst: 0 },
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
      // TEMP preview: force the intro even with reduced motion (restore the matchMedia check)
      const reducedMotion = false;
      intro.current.burst = getIntroBurst();
      if (intro.current.burst > 0) {
        gsap.set(container.current, { zIndex: BURST_Z });
        gsap.set(container.current, { clearProps: "zIndex", delay: BURST_DURATION + BACKDROP_FADE });
      }
      intro.current.active = true;
      gsap.to(intro.current, {
        settle: 1,
        delay: reducedMotion ? 0 : SETTLE_DELAY + (intro.current.burst > 0 ? BURST_DURATION : 0),
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
