"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { LOCALES, LOCALE_LABELS, LOCALE_NAMES, localePath, type Locale } from "@/i18n/config";

type MobileMenuProps = {
  items: { href: string; label: string }[];
  label: string;
  closeLabel: string;
  lang: Locale;
  languageLabel: string;
};

function subscribe(): () => void {
  return () => {};
}

export default function MobileMenu({ items, label, closeLabel, lang, languageLabel }: MobileMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = (): void => setOpen(false);

  // Reduced motion keeps the fade but shortens the slide to 2rem
  // Rendered in body: the header's backdrop-filter would otherwise contain a fixed-position drawer
  const drawer = (
    <div className="md:hidden">
      <div
        aria-hidden
        onClick={close}
        className={`fixed inset-0 z-60 bg-black/60 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        inert={!open}
        className={`fixed inset-y-0 left-0 z-70 flex h-dvh w-[85vw] flex-col border-r border-white/5 bg-neutral-950 px-6 py-4 transition-[translate,opacity,visibility] duration-300 ease-out ${
          open ? "visible translate-x-0 opacity-100" : "invisible -translate-x-full opacity-0 motion-reduce:-translate-x-8"
        }`}
      >
        <div className="flex h-8 items-center justify-between">
          <span className="font-mono font-bold text-blue-400">huy.dev</span>
          <button
            ref={closeButton}
            type="button"
            aria-label={closeLabel}
            onClick={() => {
              close();
              toggle.current?.focus();
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/5"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4">
              <path d="m3 3 10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
        <ul className="mt-8 flex-1 overflow-y-auto">
          {items.map(({ href, label: itemLabel }) => (
            <li key={href}>
              <a href={href} onClick={close} className="block py-3 text-lg text-neutral-200 hover:text-white">
                {itemLabel}
              </a>
            </li>
          ))}
        </ul>
        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 text-xs text-neutral-400">{languageLabel}</p>
          <ul className="flex gap-2">
            {LOCALES.map((locale) => (
              <li key={locale}>
                <Link
                  href={localePath(locale)}
                  hrefLang={locale}
                  lang={locale}
                  aria-label={LOCALE_NAMES[locale]}
                  aria-current={locale === lang ? "true" : undefined}
                  onClick={close}
                  className={`block rounded-full px-4 py-2 font-mono text-sm ${
                    locale === lang ? "bg-blue-600 text-white" : "border border-neutral-700 text-neutral-200"
                  }`}
                >
                  {LOCALE_LABELS[locale]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );

  return (
    <div className="md:hidden">
      <button
        ref={toggle}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-full hover:bg-white/5"
      >
        <span className="h-0.5 w-5 bg-neutral-200" />
        <span className="h-0.5 w-5 bg-neutral-200" />
        <span className="h-0.5 w-5 bg-neutral-200" />
      </button>
      {isClient && createPortal(drawer, document.body)}
    </div>
  );
}
