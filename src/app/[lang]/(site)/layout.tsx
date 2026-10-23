import { hasLocale } from "@/i18n/config";
import { DICTIONARIES } from "@/i18n/dictionary";
import { PROFILE } from "@/data/profile";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import SmoothScroll from "@/components/SmoothScroll";
import Loader from "@/components/Loader";
import HeroBackground from "@/components/HeroBackground";


export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict=DICTIONARIES[lang];

  return (
    <>
      <Header
        lang={lang}
        nav={dict.nav}
        languageLabel={dict.languageLabel}
        menuLabel={dict.menuLabel}
        closeMenuLabel={dict.closeMenuLabel}
      />
      <SmoothScroll>
        {children}
        <footer className="border-t border-neutral-800 bg-black px-6 pt-20 pb-8 md:px-10">
          <p aria-hidden className="font-display text-[clamp(2.5rem,9vw,9rem)] leading-[0.9] font-light tracking-tight text-white uppercase">
            {PROFILE.name}
          </p>
          <div className="mt-12 flex flex-col gap-6 border-t border-neutral-800 pt-6 text-sm text-neutral-400 md:flex-row md:items-center md:justify-between">
            <ul className="flex flex-wrap gap-6">
              <li>
                <a href={`mailto:${PROFILE.email}`} className="blink-hover hover:text-white">
                  {PROFILE.email}
                </a>
              </li>
              <li>
                <a href={PROFILE.github} target="_blank" rel="noopener noreferrer" className="blink-hover hover:text-white">
                  GitHub
                </a>
              </li>
              {PROFILE.linkedin && (
                <li>
                  <a href={PROFILE.linkedin} target="_blank" rel="noopener noreferrer" className="blink-hover hover:text-white">
                    LinkedIn
                  </a>
                </li>
              )}
            </ul>
            <p>
              © {new Date().getFullYear()} {PROFILE.name}
            </p>
          </div>
        </footer>
      </SmoothScroll>
      <HeroBackground />
      <Loader />
      <noscript>
        <style>{"#preloader{display:none}"}</style>
      </noscript>
    </>
  )
}