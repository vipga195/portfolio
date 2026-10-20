import SnakeGame from "@/components/games/SnakeGame";
import { hasLocale } from "@/i18n/config";
import { notFound } from "next/navigation";

export default async function SnakeGamePage({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang }=await params;
  if (!hasLocale(lang)) notFound();

  return (
    <main className="mx-auto flex flex-col gap-10 min-h-screen max-h-full max-w-5xl items-center justify-center px-6 py-24">
      <SnakeGame />
    </main>
  )
}