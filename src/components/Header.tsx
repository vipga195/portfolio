import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";

import LanguageSwitcher from "./LanguageSwitcher";
import MobileMenu from "./MobileMenu";

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
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-neutral-950/70 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <a href="#" className="font-mono font-bold text-blue-400">
          huy.dev
        </a>
        <div className="flex items-center gap-3 md:gap-6">
          <ul className="hidden gap-6 text-sm text-neutral-300 md:flex">
            {navItems.map(({ href, label }) => (
              <li key={href}>
                <a href={href} className="hover:text-white">
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <LanguageSwitcher lang={lang} label={languageLabel} />
          <MobileMenu
            items={navItems}
            label={menuLabel}
            closeLabel={closeMenuLabel}
            lang={lang}
            languageLabel={languageLabel}
          />
        </div>
      </nav>
    </header>
  );
}
