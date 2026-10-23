import Link from "next/link";
import { notFound } from "next/navigation";

import { GAMES, type GameStatus } from "@/data/games";
import { hasLocale, localizedPath, type Localized } from "@/i18n/config";
import { pageMetadata } from "@/lib/metadata";
import { isTrainingEnabled } from "@/lib/training/public-config";

// The training flag decides which entries are listed, and it is read per request
export const dynamic = "force-dynamic";

const LABELS = {
  back: { en: "← Back to portfolio", ja: "← ポートフォリオへ戻る", vi: "← Về trang portfolio" },
  title: { en: "AI Games", ja: "AIゲーム", vi: "Game AI" },
  intro: {
    en: "The AI games I am building: play them, watch the agents learn, and follow what is still in development.",
    ja: "開発中のAIゲーム一覧です。遊んだり、エージェントの学習を観戦したり、開発状況を確認できます。",
    vi: "Các game AI tôi đang phát triển: chơi thử, xem agent học và theo dõi những gì còn đang phát triển.",
  },
  open: { en: "Open →", ja: "開く →", vi: "Mở →" },
} satisfies Record<string, Localized>;

const STATUS_LABELS = {
  playable: { en: "Playable", ja: "プレイ可能", vi: "Chơi được" },
  "in-development": { en: "In development", ja: "開発中", vi: "Đang phát triển" },
} satisfies Record<GameStatus, Localized>;

export const generateMetadata = pageMetadata({
  path: "/games",
  text: {
    en: { title: "AI Games — Nguyen Trung Huy", description: "AI games in development: play Snake and follow the training experiments." },
    ja: { title: "AIゲーム — Nguyen Trung Huy", description: "開発中のAIゲーム。Snake をプレイし、学習実験の進捗を確認できます。" },
    vi: { title: "Game AI — Nguyễn Trung Huy", description: "Các game AI đang phát triển: chơi Snake và theo dõi các thử nghiệm huấn luyện." },
  },
});

export default async function GamesPage({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  const trainingEnabled = isTrainingEnabled();
  const games = GAMES.filter((game) => !game.requiresTraining || trainingEnabled);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-24">
      <Link href={localizedPath(lang, "/")} className="text-sm text-neutral-400 hover:text-blue-400">
        {LABELS.back[lang]}
      </Link>
      <h1 className="mt-6 text-3xl font-bold sm:text-4xl">{LABELS.title[lang]}</h1>
      <p className="mt-4 max-w-3xl text-lg leading-relaxed text-neutral-300">{LABELS.intro[lang]}</p>

      <ul className="mt-12 grid gap-6 sm:grid-cols-2">
        {games.map(({ id, name, path, status, summary, tags }) => (
          <li key={id} className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/60 p-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold">{name}</h2>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                  status === "playable" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
                }`}
              >
                {STATUS_LABELS[status][lang]}
              </span>
            </div>
            <p className="mt-3 flex-1 leading-relaxed text-neutral-300">{summary[lang]}</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <li key={tag} className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400">
                  {tag}
                </li>
              ))}
            </ul>
            {path && (
              <Link
                href={localizedPath(lang, path)}
                className="mt-6 self-start rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                {LABELS.open[lang]}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
