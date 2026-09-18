// "assembled": particles have formed the full-screen monogram and start shrinking into place
export type IntroPhase = "loading" | "revealing" | "assembled" | "settled";

type IntroListener = (phase: IntroPhase) => void;

// Module scope so the intro plays only once per session (survives locale switches)
let currentPhase: IntroPhase = "loading";
const listeners = new Set<IntroListener>();

export function getIntroPhase(): IntroPhase {
  return currentPhase;
}

export function setIntroPhase(phase: IntroPhase): void {
  currentPhase = phase;
  listeners.forEach((listener) => listener(phase));
}

export function subscribeIntro(listener: IntroListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Loader ring radius (px) where particles burst from before assembling; 0 = no burst
export const BURST_DURATION = 2.4;
// How long the loader backdrop takes to fade once particles start gathering
export const BACKDROP_FADE = 1.5;
let burstRadius = 0;

export function getIntroBurst(): number {
  return burstRadius;
}

export function setIntroBurst(radius: number): void {
  burstRadius = radius;
}
