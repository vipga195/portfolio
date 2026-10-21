import { notFound } from "next/navigation";
import type { Metadata } from "next";

import TrainingLab from "@/components/training/TrainingLab";
import { hasLocale } from "@/i18n/config";
import { DICTIONARIES } from "@/i18n/dictionary";
import { pageMetadata } from "@/lib/metadata";
import { isTrainingEnabled } from "@/lib/training/public-config";
import { ALGORITHM_UI } from "@/lib/training/ui-schema";

// The feature flag is read per request, never baked in at build time
export const dynamic = "force-dynamic";

const baseMetadata = pageMetadata({
  path: "/games/snake/lab",
  text: {
    en: { title: DICTIONARIES.en.trainingLab.metaTitle, description: DICTIONARIES.en.trainingLab.metaDescription },
    ja: { title: DICTIONARIES.ja.trainingLab.metaTitle, description: DICTIONARIES.ja.trainingLab.metaDescription },
    vi: { title: DICTIONARIES.vi.trainingLab.metaTitle, description: DICTIONARIES.vi.trainingLab.metaDescription },
  },
});

// Not indexed and not in the sitemap: it is an experiment page behind a flag
export async function generateMetadata(props: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  return { ...(await baseMetadata(props)), robots: { index: false, follow: false } };
}

export default async function SnakeLabPage({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  if (!isTrainingEnabled()) notFound();
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-24">
      <TrainingLab lang={lang} ui={ALGORITHM_UI} />
    </main>
  );
}
