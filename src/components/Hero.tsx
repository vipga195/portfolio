"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

import { PROFILE } from "@/data/profile";
import { getIntroPhase, subscribeIntro } from "@/lib/intro";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";

type HeroProps = {
  lang: Locale;
  labels: Dictionary["hero"];
};

type TypedTextProps = {
  text: string;
};

const CHAR_DELAY = 0.03;
const LINE_PAUSE = 0.25;

// Full text stays readable for screen readers; per-character spans keep layout fixed while typing
function TypedText({ text }: TypedTextProps): React.JSX.Element {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {Array.from(text).map((char, i) => (
          <span key={i} className="hero-char">
            {char}
          </span>
        ))}
      </span>
    </>
  );
}

export default function Hero({ lang, labels }: HeroProps): React.JSX.Element {
  const container = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        let caret: Element | null = null;
        const moveCaret = (el: Element | null): void => {
          caret?.removeAttribute("data-caret");
          el?.setAttribute("data-caret", "");
          caret = el;
        };

        const phase = getIntroPhase();
        const tl = gsap.timeline({ paused: phase === "loading" || phase === "revealing" });
        tl.from(".hero-greeting", { y: 20, opacity: 0, duration: 0.8, ease: "power3.out" });
        gsap.utils.toArray<HTMLElement>(".hero-typed").forEach((line, i) => {
          tl.from(
            line.querySelectorAll(".hero-char"),
            {
              opacity: 0,
              duration: 0.01,
              ease: "none",
              stagger: {
                each: CHAR_DELAY,
                onStart(this: gsap.core.Tween) {
                  moveCaret(this.targets<Element>()[0]);
                },
              },
            },
            i === 0 ? "-=0.4" : `+=${LINE_PAUSE}`,
          );
        });
        tl.call(() => moveCaret(null));
        tl.from(".hero-actions", { y: 20, opacity: 0, duration: 0.8, ease: "power3.out" });

        const unsubscribe = subscribeIntro((next) => {
          if (next === "assembled") tl.play();
        });
        return () => {
          unsubscribe();
          moveCaret(null);
        };
      });
    },
    { scope: container },
  );

  return (
    <section ref={container} id="hero" className="relative flex min-h-svh items-center overflow-hidden">
      <div className="mx-auto w-full max-w-5xl px-6">
        <p className="hero-greeting font-mono text-sm text-blue-400">{labels.greeting}</p>
        <h1 className="hero-typed mt-2 text-5xl font-bold tracking-tight md:text-7xl">
          <TypedText text={PROFILE.name} />
        </h1>
        <h2 className="hero-typed mt-3 text-2xl text-neutral-400 md:text-3xl">
          <TypedText text={PROFILE.title[lang]} />
        </h2>
        <p className="hero-typed mt-6 max-w-xl text-lg text-neutral-300">
          <TypedText text={PROFILE.tagline[lang]} />
        </p>
        <div className="hero-actions mt-8 flex flex-wrap gap-4">
          <a href="#projects" className="rounded-full bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700">
            {labels.viewWork}
          </a>
          <a
            href={PROFILE.cvUrl}
            className="rounded-full border border-neutral-600 px-6 py-3 font-medium hover:border-neutral-300"
          >
            {labels.downloadCv}
          </a>
        </div>
      </div>
    </section>
  );
}
