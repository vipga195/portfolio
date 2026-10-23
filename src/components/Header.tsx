import { PROFILE } from "@/data/profile";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";

import MobileMenu from "./MobileMenu";
import NavLink from "./NavLink";

type HeaderProps = {
  lang: Locale;
  nav: Dictionary["nav"];
  languageLabel: string;
  menuLabel: string;
  closeMenuLabel: string;
};

export default function Header({ lang, nav, languageLabel, menuLabel, closeMenuLabel }: HeaderProps): React.JSX.Element {
  const navItems = [
    { href: "#about", label: nav.about },
    { href: "#skills", label: nav.skills },
    { href: "#projects", label: nav.projects },
    { href: "#experience", label: nav.experience },
    { href: "#knowledge-base", label: nav.knowledge },
    { href: "#contact", label: nav.contact },
  ];

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between px-6 mix-blend-difference md:px-10">
      <NavLink hash="#" lang={lang} className="blink-hover pointer-events-auto font-display text-2xl font-bold text-white">
        <span aria-hidden>H.</span>
        <span className="sr-only">{PROFILE.name}</span>
      </NavLink>
      <MobileMenu
        items={navItems}
        label={menuLabel}
        closeLabel={closeMenuLabel}
        lang={lang}
        languageLabel={languageLabel}
      />
    </header>
  );
}
