// Per-page SEO metadata: a page only supplies its text per locale (and optionally an OG image),
// canonical / hreflang / Open Graph / Twitter fields are derived here.
// Relative imports with the .ts extension so Node can run the tests directly.
import type { Metadata } from "next";

import { PROFILE } from "../data/profile.ts";
import { DEFAULT_LOCALE, LOCALES, hasLocale, localizedPath } from "../i18n/config.ts";
import type { Locale, Localized } from "../i18n/config.ts";

const OG_LOCALES: Localized = { en: "en_US", ja: "ja_JP", vi: "vi_VN" };
const OG_IMAGE_SIZE = { width: 1200, height: 630 };

export type PageText = { title: string; description: string };

export type PageMetadataOptions = {
  // Path without the locale prefix: "/" for the home page, "/games/snake" for a nested page
  path: string;
  text: PageText;
  // Public path of the OG image; per-locale map allowed. Defaults to the per-locale home image /og/<lang>.png
  image?: string | Localized;
  type?: "website" | "profile";
};

export function buildMetadata(lang: Locale, { path, text, image, type = "website" }: PageMetadataOptions): Metadata {
  const { title, description } = text;
  const imageUrl = typeof image === "string" ? image : (image?.[lang] ?? `/og/${lang}.png`);
  const url = localizedPath(lang, path);

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(LOCALES.map((locale) => [locale, localizedPath(locale, path)])),
        "x-default": localizedPath(DEFAULT_LOCALE, path),
      },
    },
    openGraph: {
      type,
      url,
      siteName: PROFILE.name,
      title,
      description,
      locale: OG_LOCALES[lang],
      alternateLocale: LOCALES.filter((locale) => locale !== lang).map((locale) => OG_LOCALES[locale]),
      images: [{ url: imageUrl, ...OG_IMAGE_SIZE, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

// Usage in a page: export const generateMetadata = pageMetadata({ path: "/games/snake", text: { en: {...}, ja: {...}, vi: {...} } });
export function pageMetadata(
  options: Omit<PageMetadataOptions, "text"> & { text: Localized<PageText> },
): (props: { params: Promise<{ lang: string }> }) => Promise<Metadata> {
  return async ({ params }) => {
    const { lang } = await params;
    if (!hasLocale(lang)) return {};
    return buildMetadata(lang, { ...options, text: options.text[lang] });
  };
}
