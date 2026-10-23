import type { MetadataRoute } from "next";

import { LOCALES, localizedPath } from "@/i18n/config";
import { SITE_URL } from "@/lib/site";

// Page paths without the locale prefix; add a new page here so it is listed in every locale
const PAGES = ["/", "/games/snake", "/projects/go-business-support"];

function absolute(path: string): string {
  return new URL(path, SITE_URL).toString();
}

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: absolute(localizedPath(locale, path)),
      lastModified: new Date(),
      alternates: {
        languages: Object.fromEntries(LOCALES.map((l) => [l, absolute(localizedPath(l, path))])),
      },
    })),
  );
}
