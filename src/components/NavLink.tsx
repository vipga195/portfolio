"use client";

import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { localePath, type Locale } from "@/i18n/config";

const HEADER_HEIGHT = 64;

type NavLinkProps = {
  // Section anchor on the home page, e.g. "#about"
  hash: string;
  lang: Locale;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
};

// An empty id (the logo link, hash "#") means the top of the page
function scrollToSection(id: string): void {
  const target = id === "" ? null : document.getElementById(id);
  if (id !== "" && !target) return;
  // The page was just mounted: re-measure, otherwise the scroll limit is still the previous page's height
  ScrollTrigger.refresh();
  const smoother = ScrollSmoother.get();
  if (!target) {
    if (smoother) smoother.scrollTo(0, true);
    else window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (smoother) {
    smoother.scrollTo(target, true, `top ${HEADER_HEIGHT}px`);
    return;
  }
  window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - HEADER_HEIGHT, behavior: "smooth" });
}

// On the home page a plain "#hash" link lets SmoothScroll animate the scroll.
// On any other page a client-side Link keeps the layout mounted (no full reload, so the intro loader does not replay)
// and stays in the current locale. The header outlives the navigation, so this component scrolls once the home page is shown.
export default function NavLink({ hash, lang, className, onClick, children }: NavLinkProps): React.JSX.Element {
  const pathname = usePathname();
  const home = localePath(lang);
  const isHome = pathname === home || pathname === `/${lang}`;
  const pendingId = useRef<string | null>(null);

  useEffect(() => {
    if (!isHome || pendingId.current === null) return;
    const id = pendingId.current;
    pendingId.current = null;
    // Wait a frame so the new page is laid out and ScrollSmoother knows the content height
    const frame = requestAnimationFrame(() => scrollToSection(id));
    return () => cancelAnimationFrame(frame);
  }, [isHome]);

  if (isHome) {
    return (
      <a href={hash} onClick={onClick} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link
      href={`${home}${hash}`}
      onClick={() => {
        pendingId.current = hash.slice(1);
        onClick?.();
      }}
      className={className}
    >
      {children}
    </Link>
  );
}
