import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import LazyVideo from "@/components/LazyVideo";
import { PROJECTS } from "@/data/profile";
import { hasLocale, localizedPath, type Localized } from "@/i18n/config";
import { pageMetadata } from "@/lib/metadata";

const PROJECT_NAME = "GO BUSINESS Support";

const LABELS = {
  back: { en: "← Back to portfolio", ja: "← ポートフォリオへ戻る", vi: "← Về trang portfolio" },
  live: { en: "Visit the live site ↗", ja: "公開サイトを見る ↗", vi: "Xem site thực tế ↗" },
  architecture: { en: "System architecture", ja: "システム構成図", vi: "Sơ đồ kiến trúc hệ thống" },
  role: { en: "My role", ja: "担当", vi: "Vai trò của tôi" },
  stack: { en: "Tech stack", ja: "使用技術", vi: "Công nghệ" },
} satisfies Record<string, Localized>;

export const generateMetadata = pageMetadata({
  path: "/projects/go-business-support",
  type: "website",
  text: {
    en: { title: "GO BUSINESS Support — System Architecture", description: "Headless CMS, static site generation and serverless search on GCP, deployed via GitHub Actions CI/CD." },
    ja: { title: "GO BUSINESS Support — システム構成", description: "ヘッドレスCMS、静的サイト生成、サーバーレス検索を GCP 上に構築し、GitHub Actions の CI/CD でデプロイ。" },
    vi: { title: "GO BUSINESS Support — Kiến trúc hệ thống", description: "Headless CMS, static site generation và search serverless trên GCP, deploy bằng CI/CD GitHub Actions." },
  },
});

export default async function GoBusinessSupportPage({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang }=await params;
  if (!hasLocale(lang)) notFound();

  const project=PROJECTS.find(({ name }) => name===PROJECT_NAME);
  if (!project) notFound();
  const { url, summary, role, stack, media, diagram }=project;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-24">
      <Link href={localizedPath(lang, "/")} className="text-sm text-neutral-400 hover:text-blue-400">
        {LABELS.back[lang]}
      </Link>
      <h1 className="mt-6 text-3xl font-bold sm:text-4xl">{PROJECT_NAME}</h1>
      <p className="mt-4 max-w-3xl text-lg leading-relaxed text-neutral-300">{summary[lang]}</p>
      {url&&(
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block rounded-full bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
        >
          {LABELS.live[lang]}
        </a>
      )}

      {media&&(
        <div className="relative mt-12 aspect-video overflow-hidden rounded-xl bg-neutral-900">
          <LazyVideo src={media.src} poster={media.poster} label={media.alt[lang]} className="h-full w-full object-cover" />
        </div>
      )}

      {diagram&&(
        <section className="mt-12">
          <h2 className="mb-4 text-xl font-semibold text-blue-400">{LABELS.architecture[lang]}</h2>
          <Image
            src={diagram.src}
            alt={diagram.alt[lang]}
            width={2480}
            height={1395}
            sizes="(min-width: 1024px) 960px, 100vw"
            className="w-full rounded-xl border border-neutral-800"
          />
        </section>
      )}

      <section className="mt-12 grid gap-8 sm:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xl font-semibold text-blue-400">{LABELS.role[lang]}</h2>
          <p className="text-neutral-300">{role[lang]}</p>
        </div>
        <div>
          <h2 className="mb-3 text-xl font-semibold text-blue-400">{LABELS.stack[lang]}</h2>
          <ul className="flex flex-wrap gap-2">
            {stack.map((item) => (
              <li key={item} className="rounded-full bg-neutral-800 px-3 py-1 font-mono text-xs text-neutral-300">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  )
}
