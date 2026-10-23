import WorldGame from "@/components/games/WorldGame";
import { hasLocale } from "@/i18n/config";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/metadata";

// Only the text (and optionally `image`, a /public path) changes per page; canonical, hreflang, OG and Twitter are derived
export const generateMetadata = pageMetadata({
  path: "/games/fighter/world",
  text: {
    en: { title: "Stick World — Nguyen Trung Huy", description: "An open-world isometric sandbox where one general with a long pole fights and respawns, playable in the browser." },
    ja: { title: "Stick World — Nguyen Trung Huy", description: "アイソメトリックのオープンワールド・サンドボックス。長柄を持つ将軍が一人、倒されても復活します。" },
    vi: { title: "Stick World — Nguyễn Trung Huy", description: "Thế giới mở nhìn isometric, một vị tướng cầm côn dài chiến đấu và hồi sinh, chơi ngay trên trình duyệt." },
  },
});

export default async function WorldGamePage({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang }=await params;
  if (!hasLocale(lang)) notFound();

  return (
    <main className="mx-auto flex flex-col gap-10 min-h-screen max-h-full max-w-5xl items-center justify-center px-6 py-24">
      <WorldGame />
    </main>
  );
}
