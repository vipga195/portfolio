"use client";

import { useEffect, useRef, useState } from "react";

import { BIT } from "@/lib/game/fighter/inputs";
import type { InputMask } from "@/lib/game/fighter/inputs";

type PadButton={ id: string; label: string; bit: number };

type TouchControlsProps={
  onChange: (mask: InputMask) => void;
  moveLabels?: { left: string; right: string; up: string; down: string };
  // World mode: relabels the three attack buttons and adds a row of extra buttons (run, crouch, pick up)
  attackLabels?: [string, string, string];
  extraButtons?: PadButton[];
  // World mode: one-tap skill buttons that run a whole command sequence
  castButtons?: { id: string; label: string }[];
  onCast?: (id: string) => void;
};

const MOVE_BUTTONS: PadButton[]=[
  { id: "left", label: "Left", bit: BIT.LEFT },
  { id: "right", label: "Right", bit: BIT.RIGHT },
  { id: "jump", label: "Jump", bit: BIT.UP },
  { id: "crouch", label: "Crouch", bit: BIT.DOWN },
];

// Maps move button ids to the optional moveLabels prop keys
const ATTACK_LABEL_INDEX: Record<string, 0 | 1 | 2> = { thrust: 0, sweep: 1, chop: 2 };

const MOVE_LABEL_KEYS: Record<string, "left" | "right" | "up" | "down"> = { left: "left", right: "right", jump: "up", crouch: "down" };

// Low sweep = Crouch + Sweep held together, same as the keyboard
const ATTACK_BUTTONS: PadButton[]=[
  { id: "thrust", label: "Thrust", bit: BIT.THRUST },
  { id: "sweep", label: "Sweep", bit: BIT.SWEEP },
  { id: "chop", label: "Chop", bit: BIT.CHOP },
];

export default function TouchControls({ onChange, moveLabels, attackLabels, extraButtons, castButtons, onCast }: TouchControlsProps): React.JSX.Element|null {
  const [coarse, setCoarse]=useState(false);
  const [pressed, setPressed]=useState<string[]>([]);
  // Active pointer ids per button, so several fingers (and several buttons) work at once
  const activeRef=useRef<Map<string, Set<number>>>(new Map());
  const onChangeRef=useRef(onChange);

  useEffect(() => {
    onChangeRef.current=onChange;
  }, [onChange]);

  useEffect(() => {
    const mq=window.matchMedia("(any-pointer: coarse)");
    const sync=(): void => setCoarse(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Losing window focus drops any held pad button, so a stale mask is never resent
  useEffect(() => {
    const onBlur=(): void => {
      activeRef.current.clear();
      setPressed([]);
      onChangeRef.current(0);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  const emit=(): void => {
    const bits: Record<string, number>=Object.fromEntries([...MOVE_BUTTONS, ...ATTACK_BUTTONS, ...(extraButtons ?? [])].map((b) => [b.id, b.bit]));
    let mask=0;
    const ids: string[]=[];
    for (const [id, pointers] of activeRef.current) {
      if (pointers.size>0) {
        mask|=bits[id] ?? 0;
        ids.push(id);
      }
    }
    setPressed(ids);
    onChangeRef.current(mask);
  };

  const press=(id: string, e: React.PointerEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const set=activeRef.current.get(id) ?? new Set<number>();
    set.add(e.pointerId);
    activeRef.current.set(id, set);
    emit();
  };

  const release=(id: string, e: React.PointerEvent<HTMLButtonElement>): void => {
    const set=activeRef.current.get(id);
    if (!set||!set.delete(e.pointerId)) return;
    emit();
  };

  if (!coarse) return null;

  const renderButton=(b: PadButton): React.JSX.Element => (
    <button
      key={b.id}
      type="button"
      onPointerDown={(e) => press(b.id, e)}
      onPointerUp={(e) => release(b.id, e)}
      onPointerCancel={(e) => release(b.id, e)}
      onPointerLeave={(e) => release(b.id, e)}
      onLostPointerCapture={(e) => release(b.id, e)}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
      className={`min-h-14 min-w-14 flex-1 rounded-xl border border-neutral-500 px-2 text-sm font-medium select-none ${pressed.includes(b.id)? "bg-neutral-500/70 text-white":"bg-neutral-500/20"}`}
    >
      {moveLabels&&b.id in MOVE_LABEL_KEYS? moveLabels[MOVE_LABEL_KEYS[b.id]]:attackLabels&&b.id in ATTACK_LABEL_INDEX? attackLabels[ATTACK_LABEL_INDEX[b.id]]:b.label}
    </button>
  );

  return (
    // mousedown default moves focus off the canvas, which would pause the game
    <div className="mt-4 flex w-full flex-col gap-2 select-none" style={{ touchAction: "none" }} onMouseDown={(e) => e.preventDefault()}>
      <div className="flex w-full items-end justify-between gap-4">
        <div className="grid flex-1 grid-cols-2 gap-2">{MOVE_BUTTONS.map(renderButton)}</div>
        <div className="flex flex-1 flex-col gap-2">{ATTACK_BUTTONS.map(renderButton)}</div>
      </div>
      {extraButtons&&<div className="flex w-full gap-2">{extraButtons.map(renderButton)}</div>}
      {castButtons&&onCast&&(
        <div className="flex w-full gap-2">
          {castButtons.map((b) => (
            <button
              key={b.id}
              type="button"
              onPointerDown={(e) => { e.preventDefault(); onCast(b.id); }}
              onContextMenu={(e) => e.preventDefault()}
              style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
              className="min-h-14 min-w-14 flex-1 rounded-xl border border-violet-400 bg-violet-500/20 px-2 text-sm font-medium select-none active:bg-violet-500/60"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
