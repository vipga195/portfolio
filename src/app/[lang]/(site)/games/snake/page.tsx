import SnakeGame from "@/components/games/SnakeGame";
import { hasLocale } from "@/i18n/config";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/metadata";

// Only the text (and optionally `image`, a /public path) changes per page; canonical, hreflang, OG and Twitter are derived
export const generateMetadata = pageMetadata({
  path: "/games/snake",
  text: {
    en: { title: "Snake AI — Nguyen Trung Huy", description: "Play Snake yourself or watch a Q-learning agent trained in TypeScript play it in the browser." },
    ja: { title: "Snake AI — Nguyen Trung Huy", description: "スネークゲームを自分で遊ぶか、TypeScriptで学習させたQ学習エージェントのプレイをブラウザで観戦できます。" },
    vi: { title: "Snake AI — Nguyễn Trung Huy", description: "Tự chơi Snake hoặc xem agent Q-learning huấn luyện bằng TypeScript chơi ngay trên trình duyệt." },
  },
});

export default async function SnakeGamePage({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang }=await params;
  if (!hasLocale(lang)) notFound();

  return (
    <main className="mx-auto flex flex-col gap-10 min-h-screen max-h-full max-w-5xl items-center justify-center px-6 py-24">
      <SnakeGame />
    </main>
  )
}