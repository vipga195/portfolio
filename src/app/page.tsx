import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Section from "@/components/Section";
import { EXPERIENCES, PROFILE, PROJECTS, SKILLS } from "@/data/profile";

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

export default function Home(): React.JSX.Element {
  return (
    <>
      <Header />
      <main>
        <Hero />

        <Section id="about" title="About">
          <p className="reveal max-w-3xl text-lg leading-relaxed text-neutral-300">{PROFILE.about}</p>
        </Section>

        <Section id="skills" title="Skills">
          <div className="grid gap-6 sm:grid-cols-2">
            {SKILLS.map(({ title, items }) => (
              <div key={title} className="reveal rounded-2xl border border-neutral-800 p-6">
                <h3 className="mb-4 font-semibold text-blue-400">{title}</h3>
                <Tags items={items} />
              </div>
            ))}
          </div>
        </Section>

        <Section id="projects" title="Featured Work">
          <div className="grid gap-6 md:grid-cols-2">
            {PROJECTS.map(({ name, url, summary, role, teamSize, stack }) => (
              <article
                key={name}
                className="reveal flex flex-col rounded-2xl border border-neutral-800 p-6 transition-colors hover:border-blue-500/60"
              >
                <h3 className="text-xl font-semibold">
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-400">
                      {name} ↗
                    </a>
                  ) : (
                    name
                  )}
                </h3>
                <p className="mt-1 text-sm text-neutral-500">
                  {role} · Team of {teamSize}
                </p>
                <p className="mt-4 flex-1 text-neutral-300">{summary}</p>
                <div className="mt-6">
                  <Tags items={stack} />
                </div>
              </article>
            ))}
          </div>
        </Section>

        <Section id="experience" title="Experience">
          <ol className="space-y-10 border-l border-neutral-800 pl-6">
            {EXPERIENCES.map(({ company, position, period, highlights, stack }) => (
              <li key={company} className="reveal relative">
                <span className="absolute top-2 -left-[29px] h-2.5 w-2.5 rounded-full bg-blue-500" />
                <p className="font-mono text-sm text-neutral-500">{period}</p>
                <h3 className="mt-1 text-xl font-semibold">
                  {position} · <span className="text-blue-400">{company}</span>
                </h3>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-neutral-300">
                  {highlights.map((h) => (
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

        <Section id="contact" title="Contact">
          <p className="reveal max-w-xl text-lg text-neutral-300">
            Open to Front-End / Fullstack opportunities. Feel free to reach out.
          </p>
          <div className="reveal mt-8 flex flex-wrap gap-4">
            <a
              href={`mailto:${PROFILE.email}`}
              className="rounded-full bg-blue-500 px-6 py-3 font-medium text-white hover:bg-blue-400"
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
            <a
              href={PROFILE.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-neutral-600 px-6 py-3 hover:border-neutral-300"
            >
              LinkedIn
            </a>
          </div>
        </Section>
      </main>
      <footer className="py-10 text-center text-sm text-neutral-600">
        © {new Date().getFullYear()} {PROFILE.name}
      </footer>
    </>
  );
}
