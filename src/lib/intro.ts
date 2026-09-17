export type IntroPhase = "loading" | "revealing" | "settled";

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
