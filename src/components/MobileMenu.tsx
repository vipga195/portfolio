"use client";

import { ScrollSmoother } from "gsap/ScrollSmoother";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { LOCALES, LOCALE_LABELS, LOCALE_NAMES, localizedPath, stripLocalePrefix, type Locale } from "@/i18n/config";

import NavLink from "./NavLink";

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
  // Switching language keeps the current page (e.g. the Snake page), not just the home page
  const page = stripLocalePrefix(usePathname());
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;

    // Lock page scroll: ScrollSmoother intercepts wheel/touch, so pause it; without it (reduced motion) use overflow
    const smoother = ScrollSmoother.get();
    const root = document.documentElement;
    if (smoother) smoother.paused(true);
    else root.style.overflow = "hidden";

    // The menu covers the page, so start keyboard focus inside it instead of on hidden content
    menu.current?.querySelector("a")?.focus();

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    // The header logo stays clickable above the menu; any click outside the menu and toggle closes it
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !toggle.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClick);
      if (smoother) smoother.paused(false);
      else root.style.overflow = "";
    };
  }, [open]);

  // The clicked link becomes inert, so hand focus back to the toggle
  const close = (): void => {
    setOpen(false);
    toggle.current?.focus();
  };

  // Rendered in body so the header's mix-blend-difference does not apply to it
  // Stacked below the header (z-50) so the header toggle stays visible and acts as the close button
  const drawer = (
    <nav
      ref={menu}
      id="mobile-menu"
      aria-label={label}
      inert={!open}
      // Visibility transitions only on close: on open it must flip at once so focus() in the effect lands
      className={`fixed inset-0 z-40 flex h-dvh w-full flex-col bg-neutral-900 px-6 pt-24 pb-8 duration-300 md:px-10 ${
        open ? "visible opacity-100 transition-opacity" : "invisible opacity-0 transition-[opacity,visibility]"
      }`}
    >
      <ul className="group/menu flex-1 overflow-y-auto border-t border-neutral-800">
        {items.map(({ href, label: itemLabel }, i) => (
          <li key={href} className="border-b border-neutral-800">
            <NavLink
              hash={href}
              lang={lang}
              onClick={close}
              className="flex items-baseline justify-between gap-6 py-3 font-display text-[clamp(2rem,min(8vw,9dvh),6rem)] leading-none font-light text-white uppercase transition-opacity duration-300 group-hover/menu:opacity-20 hover:opacity-100!"
            >
              {itemLabel}
              <span aria-hidden className="font-mono text-base text-neutral-300">
                {String(i + 1).padStart(2, "0")}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="text-xs tracking-widest text-neutral-400 uppercase">{languageLabel}</p>
        <ul className="flex gap-2">
          {LOCALES.map((locale) => (
            <li key={locale}>
              <Link
                href={localizedPath(locale, page)}
                hrefLang={locale}
                lang={locale}
                aria-label={LOCALE_NAMES[locale]}
                aria-current={locale === lang ? "true" : undefined}
                onClick={close}
                className={`block border px-4 py-2 font-mono text-sm ${
                  locale === lang
                    ? "border-accent bg-accent text-white"
                    : "border-neutral-700 text-neutral-200 hover:border-neutral-400"
                }`}
              >
                {LOCALE_LABELS[locale]}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );

  return (
    <div className="pointer-events-auto">
      <button
        ref={toggle}
        type="button"
        aria-label={open ? closeLabel : label}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-10 w-10 flex-col items-center justify-center gap-1.5"
      >
        <span
          className={`h-0.5 w-8 bg-white transition-[translate,rotate] duration-300 ${open ? "translate-y-2 rotate-45" : ""}`}
        />
        <span className={`h-0.5 w-8 bg-white transition-opacity duration-300 ${open ? "opacity-0" : ""}`} />
        <span
          className={`h-0.5 w-8 bg-white transition-[translate,rotate] duration-300 ${open ? "-translate-y-2 -rotate-45" : ""}`}
        />
      </button>
      {/* Inline until hydrated so the links are in the server HTML (crawlers, no JS); it is invisible and inert there */}
      {isClient ? createPortal(drawer, document.body) : drawer}
    </div>
  );
}
