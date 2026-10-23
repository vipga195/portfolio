"use client";

import { useEffect, useRef, useState } from "react";

import { BIT } from "@/lib/game/fighter/inputs";
import type { InputMask } from "@/lib/game/fighter/inputs";

type TouchControlsProps={ onChange: (mask: InputMask) => void; moveLabels?: { left: string; right: string; up: string; down: string } };

type PadButton={ id: string; label: string; bit: number };

const MOVE_BUTTONS: PadButton[]=[
  { id: "left", label: "Left", bit: BIT.LEFT },
  { id: "right", label: "Right", bit: BIT.RIGHT },
  { id: "jump", label: "Jump", bit: BIT.UP },
  { id: "crouch", label: "Crouch", bit: BIT.DOWN },
];

// Maps move button ids to the optional moveLabels prop keys
const MOVE_LABEL_KEYS: Record<string, "left" | "right" | "up" | "down"> = { left: "left", right: "right", jump: "up", crouch: "down" };

// Low sweep = Crouch + Sweep held together, same as the keyboard
const ATTACK_BUTTONS: PadButton[]=[
  { id: "thrust", label: "Thrust", bit: BIT.THRUST },
  { id: "sweep", label: "Sweep", bit: BIT.SWEEP },
  { id: "chop", label: "Chop", bit: BIT.CHOP },
];

const BUTTON_BITS: Record<string, number>=Object.fromEntries([...MOVE_BUTTONS, ...ATTACK_BUTTONS].map((b) => [b.id, b.bit]));

export default function TouchControls({ onChange, moveLabels }: TouchControlsProps): React.JSX.Element|null {
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
    let mask=0;
    const ids: string[]=[];
    for (const [id, pointers] of activeRef.current) {
      if (pointers.size>0) {
        mask|=BUTTON_BITS[id] ?? 0;
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
      {moveLabels&&b.id in MOVE_LABEL_KEYS? moveLabels[MOVE_LABEL_KEYS[b.id]]:b.label}
    </button>
  );

  return (
    <div className="mt-4 flex w-full items-end justify-between gap-4 select-none" style={{ touchAction: "none" }}>
      <div className="grid flex-1 grid-cols-2 gap-2">{MOVE_BUTTONS.map(renderButton)}</div>
      <div className="flex flex-1 flex-col gap-2">{ATTACK_BUTTONS.map(renderButton)}</div>
    </div>
  );
}
