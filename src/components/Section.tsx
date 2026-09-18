"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

type SectionProps = {
  id: string;
  title: string;
  children: React.ReactNode;
};

export default function Section({ id, title, children }: SectionProps): React.JSX.Element {
  const container = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      // TEMP preview: ignore reduced motion (restore "(prefers-reduced-motion: no-preference)")
      gsap.matchMedia().add("all", () => {
        gsap.from(".reveal", {
          y: 30,
          opacity: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power2.out",
          scrollTrigger: { trigger: container.current, start: "top 80%" },
        });
      });
    },
    { scope: container },
  );

  return (
    <section ref={container} id={id} className="mx-auto w-full max-w-5xl scroll-mt-20 px-6 py-24">
      <h2 className="reveal mb-10 text-3xl font-bold md:text-4xl">{title}</h2>
      {children}
    </section>
  );
}
