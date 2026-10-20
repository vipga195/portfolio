export const LOCALES = ["en", "ja", "vi"] as const;

export type Locale = (typeof LOCALES)[number];

export type Localized<T = string> = Record<Locale, T>;

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Localized = { en: "EN", ja: "JA", vi: "VI" };

export const LOCALE_NAMES: Localized = { en: "English", ja: "日本語", vi: "Tiếng Việt" };

export function hasLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

export function localePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "/" : `/${locale}`;
}

// Default locale has no prefix: "/" and "/games/snake"; others: "/vi" and "/vi/games/snake"
export function localizedPath(locale: Locale, path: string): string {
  const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;
  return path === "/" ? prefix || "/" : `${prefix}${path}`;
}

// Inverse of localizedPath: "/vi/games/snake" -> "/games/snake", "/vi" -> "/", unprefixed paths are returned as they are
export function stripLocalePrefix(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if (first !== undefined && first !== DEFAULT_LOCALE && hasLocale(first)) return `/${rest.join("/")}`;
  return pathname;
}
