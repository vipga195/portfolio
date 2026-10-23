import FighterGame from "@/components/games/FighterGame";
import { hasLocale } from "@/i18n/config";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/metadata";

// Only the text (and optionally `image`, a /public path) changes per page; canonical, hreflang, OG and Twitter are derived
export const generateMetadata = pageMetadata({
  path: "/games/fighter",
  text: {
    en: { title: "Stick Fighter — Nguyen Trung Huy", description: "A side-view polearm stick-figure duel against an AI opponent, with three difficulty levels, playable in the browser." },
    ja: { title: "Stick Fighter — Nguyen Trung Huy", description: "長柄武器を持つ棒人間のサイドビュー対戦。3段階の難易度のAI相手とブラウザで戦えます。" },
    vi: { title: "Stick Fighter — Nguyễn Trung Huy", description: "Đấu người que cầm côn dài nhìn ngang với đối thủ AI, có ba mức độ khó, chơi ngay trên trình duyệt." },
  },
});

export default async function FighterGamePage({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang }=await params;
  if (!hasLocale(lang)) notFound();

  return (
    <main className="mx-auto flex flex-col gap-10 min-h-screen max-h-full max-w-5xl items-center justify-center px-6 py-24">
      <FighterGame />
    </main>
  )
}
