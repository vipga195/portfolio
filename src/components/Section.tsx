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
  index: number;
  label: string;
};

export default function Section({ id, title, children, index, label }: SectionProps): React.JSX.Element {
  const container = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      // Runs regardless of prefers-reduced-motion (deliberate design choice)
      gsap.matchMedia().add("all", () => {
        gsap.from(".reveal", {
          y: 30,
          opacity: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power2.out",
          scrollTrigger: { trigger: container.current, start: "top 80%" },
        });
        gsap.utils.toArray<HTMLElement>(".reveal-clip", container.current).forEach((el) => {
          gsap.fromTo(
            el,
            { clipPath: "inset(100% 0% 0% 0%)" },
            {
              clipPath: "inset(0% 0% 0% 0%)",
              duration: 1.2,
              ease: "power3.inOut",
              scrollTrigger: { trigger: el, start: "top 85%" },
            },
          );
        });
      });
    },
    { scope: container },
  );

  return (
    <section ref={container} id={id} className="w-full scroll-mt-20 border-t border-neutral-800 px-6 pt-10 pb-24 md:px-10">
      <div aria-hidden className="mb-12 flex items-start justify-between gap-6">
        <p className="reveal font-display text-[clamp(3rem,11vw,10rem)] leading-[0.85] font-light tracking-tight uppercase">
          {label}
        </p>
        <span className="reveal font-mono text-base text-neutral-300 md:text-lg">{String(index).padStart(2, "0")}</span>
      </div>
      <div className="mx-auto max-w-5xl">
        <h2 className="reveal mb-10 font-mono text-sm tracking-widest text-violet-300 uppercase">{title}</h2>
        {children}
      </div>
    </section>
  );
}
