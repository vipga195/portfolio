# Portfolio — Nguyen Trung Huy

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + GSAP + Three.js (React Three Fiber).

## Scripts

```bash
npm run dev     # http://localhost:3000
npm run lint
npm run build
```

## Structure

```
src/
  app/            layout, page, globals.css
  components/     Header, Hero (GSAP intro), HeroScene (Three.js particles), Section (ScrollTrigger reveal)
  data/profile.ts all content (profile, skills, projects, experience)
.github/workflows/ci.yml   lint + typecheck + build
```

Content is edited only in `src/data/profile.ts`.

## Done

- Sections: Hero, About, Skills, Featured Work, Experience, Contact
- Three.js particle background (client-only), GSAP intro and scroll reveal (respects `prefers-reduced-motion`)
- GitHub Actions CI

## TODO

- [ ] Update real GitHub / LinkedIn links in `profile.ts`
- [ ] Add `public/cv.pdf`
- [ ] Rewrite project summaries as case studies (problem -> solution -> result), check NDA first
- [ ] Add screenshots / videos for projects
- [ ] Move content to Contentful
- [ ] i18n (EN / JA)
- [ ] Side projects section (Contentful extension, fullstack app, animation lab)
- [ ] Deploy to Vercel, Lighthouse CI
