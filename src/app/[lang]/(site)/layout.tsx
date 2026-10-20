import { hasLocale, Locale, Localized } from "@/i18n/config";
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
        <footer className="py-10 text-center text-sm text-neutral-400">
          © {new Date().getFullYear()} {PROFILE.name}
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