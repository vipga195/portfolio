# Nguyen Trung Huy — Front-End Developer

Front-End Developer with **7+ years of experience** building complex web experiences for Japanese clients using React, Next.js, Vue.js and Nuxt.js. I extend Contentful CMS, run CI/CD pipelines on GitHub, and craft interactive UI with GSAP and Three.js. Currently growing toward Fullstack development.

- Email: [trunghuy1701@gmail.com](mailto:trunghuy1701@gmail.com)
- GitHub: [@vipga195](https://github.com/vipga195)
- CV: [CV_NGUYEN_TRUNG_HUY_FRONTEND_ATS.pdf](public/CV_NGUYEN_TRUNG_HUY_FRONTEND_ATS.pdf)

---

## Skills

| Area | Technologies |
|---|---|
| Frontend | React, Next.js, Vue.js, Nuxt.js, Vite, React Native, Tailwind CSS, SASS |
| Animation & 3D | GSAP, Three.js, Animate.js |
| CMS & Backend | Contentful (custom extensions), Node.js, RESTful API |
| Quality & Performance | SEO Optimization, Accessibility (a11y), Performance Tuning |
| Workflow | GitHub Actions, Git, Agile / Scrum |

## Featured Work

| Project | Role | Team | Stack |
|---|---|---|---|
| [DeNA Corporate Site](https://dena.com) | Develop and maintain | 8 | Next.js, Contentful, GSAP, GitHub Actions |
| [GO Inc.](https://go.goinc.jp) | Develop and maintain | 5 | Next.js, GSAP |
| [Wonderia](https://wonderia.jp) | Develop and maintain | 2 | Vite, Three.js, GSAP |
| [DeNA AI Link](https://dena-ailink.com) | Develop and maintain | 2 | Next.js, Contentful |
| [DeNA Alumni](https://alumi.dena.com) | Develop and maintain | 3 | Nuxt.js |

## Experience

**Gianty Vietnam** — Front-End Developer · 01/2022 – Present
- Develop and maintain front-end for Japanese client projects
- Extend and customize Contentful CMS
- Build and maintain CI/CD pipelines with GitHub
- Maintain and develop Node.js services
- Build UI animation with GSAP, Three.js, Animate.js

**Minerva Solution** — Front-End Developer · 08/2020 – 12/2021
- Built Sale Admin, CCTV App, Platform Workflow and Internet Banking (Vue.js)
- Sliced responsive layouts and coordinated API/JSON contracts with back-end team

**Thien Duong Cong Nghe** — Front-End Developer · 05/2019 – 08/2020
- Fixxy Admin Web with React.js + Ant Design
- Emartmall and ERP mobile apps with React Native

## Education

University of Science (HCMUS) — Information Technology, 2013 – 2016

---

## About this site

Built with Next.js 16 (App Router), TypeScript, Tailwind CSS v4, GSAP (ScrollTrigger, ScrollSmoother) and Three.js.

- Three.js signature hero: particles assemble into the "H." monogram with idle wave/sway and pointer repulsion, GSAP intro and scroll reveal (`prefers-reduced-motion`: no intro, softer idle motion)
- English (default, `/`), Japanese (`/ja`), Vietnamese (`/vi`) with static generation, hreflang alternates and language dropdown on desktop, language options inside the mobile menu (client-side navigation via `next/link`); `/en` redirects to `/`
- Smooth scrolling with GSAP ScrollSmoother, including anchor navigation
- Mobile drawer menu: slides + fades in from the left, 85vw wide, full height; closes on overlay / link click / Escape
- Text colors meet WCAG AA contrast (4.5:1) on the dark background
- Knowledge Base section with technical notes
- Featured Work cards support optional metrics and image/video demo (`metrics`, `media` in `Project`)
- Custom favicon (`src/app/icon.svg`, `favicon.ico`, `apple-icon.png`)
- All content lives in [`src/data/profile.ts`](src/data/profile.ts) (localized fields), UI strings in [`src/i18n/dictionary.ts`](src/i18n/dictionary.ts)
- GitHub Actions CI: lint, typecheck, build, publish Docker image to GHCR

### Run locally

```bash
npm install
npm run dev
```

### Run with Docker

```bash
docker compose up -d   # http://localhost:1995
docker compose down
```

### Auto deploy

Push to `main` -> CI (lint, typecheck, build) -> image `ghcr.io/vipga195/portfolio:latest` (linux/arm64) -> signed webhook to [deploy-hook](../../deploy-hook) -> `docker compose pull && up -d`.

Requires repo variable `DEPLOY_URL` and secret `DEPLOY_SECRET`; the `deploy` job is skipped until they are set.

### Roadmap

- [x] Real GitHub link, LinkedIn button hidden until a URL is set
- [x] Skills: SEO, Accessibility, Performance Tuning
- [x] LinkedIn URL (`PROFILE.linkedin`)
- [ ] Metrics (Core Web Vitals, performance) for DeNA, GO Inc., Wonderia — rendering ready, data pending
- [ ] Thumbnails / demo videos for Featured Work — rendering ready, assets pending

- [ ] Case studies with screenshots (problem → solution → result)
- [ ] Full Knowledge Base articles (detail pages)
- [ ] Content managed in Contentful
- [x] English / Japanese / Vietnamese (i18n)
- [x] Signature hero (particle "H." monogram)
- [ ] Side projects: Contentful extension, fullstack app, animation lab
- [ ] Deploy to Vercel with Lighthouse CI
