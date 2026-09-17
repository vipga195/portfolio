export const LOCALES = ["en", "ja", "vi"] as const;

export type Locale = (typeof LOCALES)[number];

export type Localized<T = string> = Record<Locale, T>;

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Localized = { en: "EN", ja: "JA", vi: "VI" };

export function hasLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

export function localePath(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "/" : `/${locale}`;
}
