"use client";

import gsap from "gsap";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

const HEADER_OFFSET = "top 64px";

type SmoothScrollProps = {
  children: React.ReactNode;
};

export default function SmoothScroll({ children }: SmoothScrollProps): React.JSX.Element {
  useGSAP(() => {
    gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
      const smoother = ScrollSmoother.create({
        wrapper: "#smooth-wrapper",
        content: "#smooth-content",
        smooth: 1.2,
        effects: true,
        smoothTouch: 0.1,
      });
      ScrollTrigger.refresh();

      const onClick = (e: MouseEvent): void => {
        if (!(e.target instanceof Element)) return;
        const link = e.target.closest<HTMLAnchorElement>('a[href^="#"]');
        if (!link) return;
        const hash = link.getAttribute("href") ?? "#";
        e.preventDefault();
        if (hash === "#") {
          smoother.scrollTo(0, true);
          return;
        }
        const target = document.querySelector(hash);
        if (target) smoother.scrollTo(target, true, HEADER_OFFSET);
      };

      document.addEventListener("click", onClick);
      return () => document.removeEventListener("click", onClick);
    });
  });

  return (
    <div id="smooth-wrapper">
      <div id="smooth-content">{children}</div>
    </div>
  );
}
