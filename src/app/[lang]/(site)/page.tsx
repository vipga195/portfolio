import Image from "next/image";
import { notFound } from "next/navigation";

import ContactForm from "@/components/ContactForm";
import Hero from "@/components/Hero";
import LazyVideo from "@/components/LazyVideo";
import Marquee from "@/components/Marquee";
import Section from "@/components/Section";
import { EXPERIENCES, KNOWLEDGE_BASE, PROFILE, PROJECTS, SKILLS } from "@/data/profile";
import { hasLocale, localizedPath } from "@/i18n/config";
import { DICTIONARIES } from "@/i18n/dictionary";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = pageMetadata({
  path: "/",
  type: "profile",
  text: { en: DICTIONARIES.en.meta, ja: DICTIONARIES.ja.meta, vi: DICTIONARIES.vi.meta },
});

function Tags({ items }: { items: string[] }): React.JSX.Element {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="border border-neutral-700 px-3 py-1 font-mono text-xs text-neutral-300">
          {item}
        </li>
      ))}
    </ul>
  );
}

export default async function Home({ params }: PageProps<"/[lang]">): Promise<React.JSX.Element> {
  const { lang }=await params;
  if (!hasLocale(lang)) notFound();
  const dict=DICTIONARIES[lang];

  return (
      <main>
        <Hero lang={lang} labels={dict.hero} />
        <Marquee items={SKILLS[0].items} />
        <Section id="about" title={dict.sections.about} index={1} label={DICTIONARIES.en.sections.about}>
          <p className="reveal max-w-3xl text-lg leading-relaxed text-neutral-300">{PROFILE.about[lang]}</p>
        </Section>

        <Section id="skills" title={dict.sections.skills} index={2} label={DICTIONARIES.en.sections.skills}>
          <div className="grid gap-6 sm:grid-cols-2">
            {SKILLS.map(({ title, items }) => (
              <div key={title.en} className="reveal border border-neutral-800 p-6">
                <h3 className="mb-4 font-semibold text-violet-300">{title[lang]}</h3>
                <Tags items={items} />
              </div>
            ))}
          </div>
        </Section>

        <Section id="projects" title={dict.sections.projects} index={3} label={DICTIONARIES.en.sections.projects}>
          <div className="grid gap-6 md:grid-cols-2">
            {PROJECTS.map(({ name, url, summary, role, teamSize, stack, metrics, media }) => (
              <article
                key={name}
                className="group reveal flex flex-col border border-neutral-800 p-6 transition-colors hover:border-accent"
              >
                {media&&(
                  <div className="reveal-clip relative mb-6 aspect-video overflow-hidden bg-neutral-900">
                    <div data-speed="auto" className="absolute inset-x-0 -top-[10%] h-[120%]">
                      {media.type==="video"? (
                        <LazyVideo
                          src={media.src}
                          poster={media.poster}
                          label={media.alt[lang]}
                          className="h-full w-full object-cover transition-[scale] duration-700 ease-out group-hover:scale-105"
                        />
                      ):(
                        <Image
                          src={media.src}
                          alt={media.alt[lang]}
                          fill
                          sizes="(min-width: 768px) 50vw, 100vw"
                          className="object-cover transition-[scale] duration-700 ease-out group-hover:scale-105"
                        />
                      )}
                    </div>
                  </div>
                )}
                <h3 className="text-xl font-semibold">
                  {url? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="blink-hover hover:text-violet-300">
                      {name} ↗
                    </a>
                  ):(
                    name
                  )}
                </h3>
                <p className="mt-1 text-sm text-neutral-400">
                  {role[lang]} · {dict.teamOf(teamSize)}
                </p>
                <p className="mt-4 flex-1 text-neutral-300">{summary[lang]}</p>
                {metrics&&metrics.length>0&&(
                  <dl className="mt-6 grid grid-cols-2 gap-4">
                    {metrics.map(({ label, value }) => (
                      <div key={label.en}>
                        <dt className="text-xs text-neutral-400">{label[lang]}</dt>
                        <dd className="font-mono text-lg font-semibold text-highlight">{value}</dd>
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

        <Section id="experience" title={dict.sections.experience} index={4} label={DICTIONARIES.en.sections.experience}>
          <ol className="space-y-10 border-l border-neutral-800 pl-6">
            {EXPERIENCES.map(({ company, position, period, highlights, stack }) => (
              <li key={company} className="reveal relative">
                <span className="absolute top-2 -left-7.25 h-2.5 w-2.5 bg-accent" />
                <p className="font-mono text-sm text-neutral-400">{period[lang]}</p>
                <h3 className="mt-1 text-xl font-semibold">
                  {position} · <span className="text-violet-300">{company}</span>
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

        <Section id="knowledge-base" title={dict.sections.knowledgeBase} index={5} label={DICTIONARIES.en.sections.knowledgeBase}>
          <div className="grid gap-6 md:grid-cols-2">
            {KNOWLEDGE_BASE.map(({ title, summary, tags, url }) => (
              <article key={title.en} className="reveal flex flex-col border border-neutral-800 p-6">
                <h3 className="text-lg font-semibold">
                  {url? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="blink-hover hover:text-violet-300">
                      {title[lang]} ↗
                    </a>
                  ):(
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

        <Section id="contact" title={dict.sections.contact} index={6} label={DICTIONARIES.en.sections.contact}>
          <p className="reveal max-w-xl text-lg text-neutral-300">{dict.contactText}</p>
          <div className="reveal mt-8 flex flex-wrap gap-4">
            <a
              href={`mailto:${PROFILE.email}`}
              className="blink-hover bg-accent px-6 py-3 font-medium text-white hover:bg-accent/80"
            >
              {PROFILE.email}
            </a>
            <a
              href={PROFILE.github}
              target="_blank"
              rel="noopener noreferrer"
              className="blink-hover border border-neutral-600 px-6 py-3 hover:border-neutral-300"
            >
              GitHub
            </a>
            <a
              href={localizedPath(lang, PROFILE.aiApps.path)}
              className="blink-hover border border-neutral-600 px-6 py-3 hover:border-neutral-300"
            >
              {PROFILE.aiApps.label[lang]}
            </a>
            {PROFILE.linkedin&&(
              <a
                href={PROFILE.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="blink-hover border border-neutral-600 px-6 py-3 hover:border-neutral-300"
              >
                LinkedIn
              </a>
            )}
          </div>
          <div className="reveal mt-12 max-w-xl">
            <ContactForm lang={lang} labels={dict.contactForm} />
          </div>
        </Section>
      </main>
  )
}
