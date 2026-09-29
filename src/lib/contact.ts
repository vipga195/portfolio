import { DEFAULT_LOCALE, hasLocale, type Locale } from "@/i18n/config";

export type ContactMessage = {
  name: string;
  email: string;
  company: string;
  message: string;
  locale: Locale;
};

export const HONEYPOT_FIELD = "website";

type ParseResult =
  | { ok: true; data: ContactMessage }
  | { ok: false; field: "name" | "email" | "company" | "message" | "body" };

export function parseContact(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, field: "body" };
  }

  // input narrowed to object (non-null), safe to cast to Record
  const obj = input as Record<string, unknown>;

  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (name.length < 1 || name.length > 100) {
    return { ok: false, field: "name" };
  }

  const email = typeof obj.email === "string" ? obj.email.trim() : "";
  if (email.length === 0 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, field: "email" };
  }

  const company = typeof obj.company === "string" ? obj.company.trim() : "";
  if (company.length > 200) {
    return { ok: false, field: "company" };
  }

  const message = typeof obj.message === "string" ? obj.message.trim() : "";
  if (message.length < 10 || message.length > 5000) {
    return { ok: false, field: "message" };
  }

  const localeStr = typeof obj.locale === "string" ? obj.locale.trim() : "";
  const locale = hasLocale(localeStr) ? localeStr : DEFAULT_LOCALE;

  return {
    ok: true,
    data: {
      name,
      email,
      company,
      message,
      locale,
    },
  };
}
