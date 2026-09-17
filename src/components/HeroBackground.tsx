"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const HeroScene = dynamic(() => import("./HeroScene"), { ssr: false });

const HERO_SELECTOR = "#hero";
const MAX_OPACITY = 0.7;

export default function HeroBackground(): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

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
  });

  return (
    <div ref={container} aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <HeroScene paused={paused} />
    </div>
  );
}
