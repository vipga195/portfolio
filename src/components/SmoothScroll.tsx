"use client";

import gsap from "gsap";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, ScrollSmoother, ScrollToPlugin, useGSAP);

const HEADER_HEIGHT = 64;
const HEADER_OFFSET = `top ${HEADER_HEIGHT}px`;
const SCROLL_DURATION = 1.2;
const SCROLL_EASE = "power3.inOut";

type PerformanceLevel = "low" | "high";

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: { effectiveType?: string };
};

type SmoothScrollProps = {
  children: React.ReactNode;
};

export default function SmoothScroll({
  children,
}: SmoothScrollProps): React.JSX.Element {
  const getPerformanceLevel = (): PerformanceLevel => {
    const navigator: NavigatorWithHints = window.navigator;
    const ram = navigator.deviceMemory || 4;

    const cpuCores = navigator.hardwareConcurrency || 4;

    const connection = navigator.connection || {};
    const isSlowConn = ["slow-2g", "2g", "3g"].includes(
      connection.effectiveType ?? "",
    );

    if (ram < 4 || cpuCores < 4 || isSlowConn) {
      return "low";
    }
    return "high";
  };

  useGSAP(() => {
    ScrollTrigger.config({
      autoRefreshEvents: "resize,load,visibilitychange,DOMContentLoaded",
    });
    gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
      const perf = getPerformanceLevel();
      const isTouch = ScrollTrigger.isTouch === 1;
      ScrollSmoother.create({
        smooth: 1,
        effects: true,
        smoothTouch: perf === "low" && isTouch ? false : 0.5,
        normalizeScroll: true,
        ignoreMobileResize: true,
      });
      ScrollTrigger.refresh();
    });

    const findTarget = (hash: string): HTMLElement | null => {
      if (hash.length <= 1) return null;
      try {
        return document.getElementById(decodeURIComponent(hash.slice(1)));
      } catch {
        return null;
      }
    };

    const scrollToTarget = (target: HTMLElement | null): void => {
      const smoother = ScrollSmoother.get();
      if (smoother) {
        gsap.to(smoother, {
          scrollTop: target ? smoother.offset(target, HEADER_OFFSET) : 0,
          duration: SCROLL_DURATION,
          ease: SCROLL_EASE,
          overwrite: true,
        });
        return;
      }

      gsap.to(window, {
        scrollTo: target ? { y: target, offsetY: HEADER_HEIGHT } : 0,
        duration: SCROLL_DURATION,
        ease: SCROLL_EASE,
        overwrite: true,
      });
    };

    const onClick = (e: MouseEvent): void => {
      if (!(e.target instanceof Element)) return;
      const link = e.target.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!link) return;
      const hash = link.getAttribute("href") ?? "#";
      const target = findTarget(hash);
      if (hash !== "#" && !target) return;
      e.preventDefault();
      scrollToTarget(target);
    };

    const scrollToInitialHash = (): void => {
      const target = findTarget(window.location.hash);
      if (target) scrollToTarget(target);
    };

    if (document.readyState === "complete") {
      scrollToInitialHash();
    } else {
      window.addEventListener("load", scrollToInitialHash, { once: true });
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("load", scrollToInitialHash);
    };
  });

  return (
    <div id="smooth-wrapper">
      <div id="smooth-content">{children}</div>
    </div>
  );
}
