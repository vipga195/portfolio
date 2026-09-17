import Image from "next/image";
import { notFound } from "next/navigation";

import Header from "@/components/Header";
import Hero from "@/components/Hero";
import HeroBackground from "@/components/HeroBackground";
import Loader from "@/components/Loader";
import Section from "@/components/Section";
import SmoothScroll from "@/components/SmoothScroll";
import { EXPERIENCES, KNOWLEDGE_BASE, PROFILE, PROJECTS, SKILLS } from "@/data/profile";
import { hasLocale } from "@/i18n/config";
import { DICTIONARIES } from "@/i18n/dictionary";

function Tags({ items }: { items: string[] }): React.JSX.Element {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-full bg-neutral-800 px-3 py-1 font-mono text-xs text-neutral-300">
          {item}
        </li>
      ))}
    </ul>
  );
}

export default async function Home({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = DICTIONARIES[lang];

  return (
    <>
      <Header
        lang={lang}
        nav={dict.nav}
        languageLabel={dict.languageLabel}
        menuLabel={dict.menuLabel}
        closeMenuLabel={dict.closeMenuLabel}
      />
      <SmoothScroll>
        <main>
          <Hero lang={lang} labels={dict.hero} />

          <Section id="about" title={dict.sections.about}>
            <p className="reveal max-w-3xl text-lg leading-relaxed text-neutral-300">{PROFILE.about[lang]}</p>
          </Section>

          <Section id="skills" title={dict.sections.skills}>
            <div className="grid gap-6 sm:grid-cols-2">
              {SKILLS.map(({ title, items }) => (
                <div key={title.en} className="reveal rounded-2xl border border-neutral-800 p-6">
                  <h3 className="mb-4 font-semibold text-blue-400">{title[lang]}</h3>
                  <Tags items={items} />
                </div>
              ))}
            </div>
          </Section>

          <Section id="projects" title={dict.sections.projects}>
            <div className="grid gap-6 md:grid-cols-2">
              {PROJECTS.map(({ name, url, summary, role, teamSize, stack, metrics, media }) => (
                <article
                  key={name}
                  className="reveal flex flex-col rounded-2xl border border-neutral-800 p-6 transition-colors hover:border-blue-500/60"
                >
                  {media && (
                    <div className="relative mb-6 aspect-video overflow-hidden rounded-xl bg-neutral-900">
                      {media.type === "video" ? (
                        <video
                          src={media.src}
                          poster={media.poster}
                          aria-label={media.alt[lang]}
                          className="h-full w-full object-cover"
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="none"
                        />
                      ) : (
                        <Image
                          src={media.src}
                          alt={media.alt[lang]}
                          fill
                          sizes="(min-width: 768px) 50vw, 100vw"
                          className="object-cover"
                        />
                      )}
                    </div>
                  )}
                  <h3 className="text-xl font-semibold">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {name} ↗
                      </a>
                    ) : (
                      name
                    )}
                  </h3>
                  <p className="mt-1 text-sm text-neutral-400">
                    {role[lang]} · {dict.teamOf(teamSize)}
                  </p>
                  <p className="mt-4 flex-1 text-neutral-300">{summary[lang]}</p>
                  {metrics && metrics.length > 0 && (
                    <dl className="mt-6 grid grid-cols-2 gap-4">
                      {metrics.map(({ label, value }) => (
                        <div key={label.en}>
                          <dt className="text-xs text-neutral-400">{label[lang]}</dt>
                          <dd className="font-mono text-lg font-semibold text-blue-400">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div className="mt-6">
                    <Tags items={stack} />
                  </div>
                </article>
              ))}
            </div>
          </Section>

          <Section id="experience" title={dict.sections.experience}>
            <ol className="space-y-10 border-l border-neutral-800 pl-6">
              {EXPERIENCES.map(({ company, position, period, highlights, stack }) => (
                <li key={company} className="reveal relative">
                  <span className="absolute top-2 -left-7.25 h-2.5 w-2.5 rounded-full bg-blue-500" />
                  <p className="font-mono text-sm text-neutral-400">{period[lang]}</p>
                  <h3 className="mt-1 text-xl font-semibold">
                    {position} · <span className="text-blue-400">{company}</span>
                  </h3>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-neutral-300">
                    {highlights[lang].map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    <Tags items={stack} />
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="knowledge-base" title={dict.sections.knowledgeBase}>
            <div className="grid gap-6 md:grid-cols-2">
              {KNOWLEDGE_BASE.map(({ title, summary, tags, url }) => (
                <article key={title.en} className="reveal flex flex-col rounded-2xl border border-neutral-800 p-6">
                  <h3 className="text-lg font-semibold">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                        {title[lang]} ↗
                      </a>
                    ) : (
                      title[lang]
                    )}
                  </h3>
                  <p className="mt-3 flex-1 text-neutral-300">{summary[lang]}</p>
                  <div className="mt-6">
                    <Tags items={tags} />
                  </div>
                </article>
              ))}
            </div>
          </Section>

          <Section id="contact" title={dict.sections.contact}>
            <p className="reveal max-w-xl text-lg text-neutral-300">{dict.contactText}</p>
            <div className="reveal mt-8 flex flex-wrap gap-4">
              <a
                href={`mailto:${PROFILE.email}`}
                className="rounded-full bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
              >
                {PROFILE.email}
              </a>
              <a
                href={PROFILE.github}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-neutral-600 px-6 py-3 hover:border-neutral-300"
              >
                GitHub
              </a>
              {PROFILE.linkedin && (
                <a
                  href={PROFILE.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-neutral-600 px-6 py-3 hover:border-neutral-300"
                >
                  LinkedIn
                </a>
              )}
            </div>
          </Section>
        </main>
        <footer className="py-10 text-center text-sm text-neutral-400">
          © {new Date().getFullYear()} {PROFILE.name}
        </footer>
      </SmoothScroll>
      <HeroBackground />
      <Loader />
    </>
  );
}
