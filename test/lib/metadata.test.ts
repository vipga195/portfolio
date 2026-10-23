import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { localizedPath, stripLocalePrefix } from "../../src/i18n/config.ts";
import { buildMetadata, pageMetadata } from "../../src/lib/metadata.ts";

const TEXT = { title: "Title", description: "Description" };

describe("localizedPath", () => {
  it("leaves the default locale unprefixed", () => {
    assert.equal(localizedPath("en", "/"), "/");
    assert.equal(localizedPath("en", "/games/snake"), "/games/snake");
  });

  it("prefixes other locales", () => {
    assert.equal(localizedPath("vi", "/"), "/vi");
    assert.equal(localizedPath("ja", "/games/snake"), "/ja/games/snake");
  });
});

describe("stripLocalePrefix", () => {
  it("removes a non-default locale prefix", () => {
    assert.equal(stripLocalePrefix("/vi"), "/");
    assert.equal(stripLocalePrefix("/ja/games/snake"), "/games/snake");
  });

  it("leaves unprefixed paths alone", () => {
    assert.equal(stripLocalePrefix("/"), "/");
    assert.equal(stripLocalePrefix("/games/snake"), "/games/snake");
  });

  it("does not strip a path that merely starts with a locale-like word", () => {
    assert.equal(stripLocalePrefix("/vietnam"), "/vietnam");
  });

  it("round-trips with localizedPath", () => {
    for (const locale of ["en", "ja", "vi"] as const) {
      assert.equal(stripLocalePrefix(localizedPath(locale, "/games/snake")), "/games/snake");
      assert.equal(stripLocalePrefix(localizedPath(locale, "/")), "/");
    }
  });
});

describe("buildMetadata", () => {
  it("derives canonical, hreflang and Open Graph url from the page path", () => {
    const meta = buildMetadata("vi", { path: "/games/snake", text: TEXT });
    assert.equal(meta.alternates?.canonical, "/vi/games/snake");
    assert.deepEqual(meta.alternates?.languages, {
      en: "/games/snake",
      ja: "/ja/games/snake",
      vi: "/vi/games/snake",
      "x-default": "/games/snake",
    });
    assert.equal(meta.openGraph?.url, "/vi/games/snake");
    assert.equal(meta.openGraph?.locale, "vi_VN");
  });

  it("defaults the OG image to the per-locale home image", () => {
    const meta = buildMetadata("ja", { path: "/", text: TEXT });
    assert.deepEqual(meta.openGraph?.images, [{ url: "/og/ja.png", width: 1200, height: 630, alt: "Title" }]);
  });

  it("accepts one image for every locale or a per-locale map", () => {
    const one = buildMetadata("en", { path: "/", text: TEXT, image: "/og/snake.png" });
    assert.deepEqual(one.openGraph?.images, [{ url: "/og/snake.png", width: 1200, height: 630, alt: "Title" }]);
    const perLocale = buildMetadata("vi", { path: "/", text: TEXT, image: { en: "/a.png", ja: "/b.png", vi: "/c.png" } });
    assert.deepEqual(perLocale.openGraph?.images, [{ url: "/c.png", width: 1200, height: 630, alt: "Title" }]);
  });
});

describe("pageMetadata", () => {
  const generate = pageMetadata({
    path: "/x",
    text: { en: { title: "E", description: "e" }, ja: { title: "J", description: "j" }, vi: { title: "V", description: "v" } },
  });

  it("picks the text of the requested locale", async () => {
    const meta = await generate({ params: Promise.resolve({ lang: "ja" }) });
    assert.equal(meta.title, "J");
    assert.equal(meta.description, "j");
  });

  it("returns empty metadata for an unknown locale", async () => {
    assert.deepEqual(await generate({ params: Promise.resolve({ lang: "xx" }) }), {});
  });
});
