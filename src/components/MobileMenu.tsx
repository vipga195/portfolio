"use client";

import { useEffect, useState } from "react";

type MobileMenuProps = {
  items: { href: string; label: string }[];
  label: string;
};

export default function MobileMenu({ items, label }: MobileMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-full hover:bg-white/5"
      >
        <span className={`h-0.5 w-5 bg-neutral-200 transition-transform ${open ? "translate-y-2 rotate-45" : ""}`} />
        <span className={`h-0.5 w-5 bg-neutral-200 transition-opacity ${open ? "opacity-0" : ""}`} />
        <span className={`h-0.5 w-5 bg-neutral-200 transition-transform ${open ? "-translate-y-2 -rotate-45" : ""}`} />
      </button>
      <ul
        id="mobile-menu"
        hidden={!open}
        className="absolute inset-x-0 top-16 border-b border-white/5 bg-neutral-950/95 px-6 py-4 backdrop-blur"
      >
        {items.map(({ href, label: itemLabel }) => (
          <li key={href}>
            <a href={href} onClick={() => setOpen(false)} className="block py-3 text-lg text-neutral-200 hover:text-white">
              {itemLabel}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
