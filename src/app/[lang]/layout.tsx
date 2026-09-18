import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";

import { PROFILE } from "@/data/profile";
import { DEFAULT_LOCALE, LOCALES, hasLocale, localePath, type Localized } from "@/i18n/config";
import { DICTIONARIES } from "@/i18n/dictionary";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "vietnamese"],
});

const SITE_URL = "https://portfolio.cocahome.click";

const OG_LOCALES: Localized = { en: "en_US", ja: "ja_JP", vi: "vi_VN" };

export const dynamicParams = false;

export function generateStaticParams(): { lang: string }[] {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const { title, description } = DICTIONARIES[lang].meta;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: {
      canonical: localePath(lang),
      languages: {
        ...Object.fromEntries(LOCALES.map((locale) => [locale, localePath(locale)])),
        "x-default": localePath(DEFAULT_LOCALE),
      },
    },
    openGraph: {
      type: "profile",
      url: localePath(lang),
      siteName: PROFILE.name,
      title,
      description,
      locale: OG_LOCALES[lang],
      alternateLocale: LOCALES.filter((locale) => locale !== lang).map((locale) => OG_LOCALES[locale]),
      images: [{ url: `/og/${lang}.png`, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
