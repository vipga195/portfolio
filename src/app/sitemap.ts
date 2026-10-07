import type { MetadataRoute } from "next";

import { LOCALES, localePath } from "@/i18n/config";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return LOCALES.map((locale) => {
    const url = new URL(localePath(locale), SITE_URL).toString();
    return {
      url,
      lastModified: new Date(),
      alternates: {
        languages: Object.fromEntries(
          LOCALES.map((l) => [l, new URL(localePath(l), SITE_URL).toString()])
        ),
      },
    };
  });
}
