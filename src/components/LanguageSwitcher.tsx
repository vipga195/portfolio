"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { LOCALES, LOCALE_LABELS, LOCALE_NAMES, localePath, type Locale } from "@/i18n/config";

type LanguageSwitcherProps = {
  lang: Locale;
  label: string;
};

export default function LanguageSwitcher({ lang, label }: LanguageSwitcherProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && !container.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative hidden md:block">
      <button
        ref={button}
        type="button"
        aria-label={`${label}: ${LOCALE_NAMES[lang]}`}
        aria-expanded={open}
        aria-controls="language-list"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 rounded-full border border-neutral-700 px-3 py-1.5 font-mono text-xs text-neutral-200 hover:border-neutral-400"
      >
        {LOCALE_LABELS[lang]}
        <svg aria-hidden viewBox="0 0 12 12" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <ul
        id="language-list"
        hidden={!open}
        className="absolute right-0 mt-2 min-w-36 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 py-1 shadow-lg"
      >
        {LOCALES.map((locale) => (
          <li key={locale}>
            <Link
              href={localePath(locale)}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === lang ? "true" : undefined}
              onClick={() => setOpen(false)}
              className={`flex items-center justify-between gap-4 px-4 py-2 text-sm hover:bg-white/5 ${
                locale === lang ? "text-blue-400" : "text-neutral-200"
              }`}
            >
              {LOCALE_NAMES[locale]}
              <span className="font-mono text-xs text-neutral-400">{LOCALE_LABELS[locale]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
