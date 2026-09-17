import type { Localized } from "@/i18n/config";

export type SkillGroup = {
  title: Localized;
  items: string[];
};

export type ProjectMetric = {
  label: Localized;
  value: string;
};

export type ProjectMedia = {
  type: "image" | "video";
  src: string;
  poster?: string;
  alt: Localized;
};

export type Project = {
  name: string;
  url?: string;
  summary: Localized;
  role: Localized;
  teamSize: number;
  stack: string[];
  metrics?: ProjectMetric[];
  media?: ProjectMedia;
};

export type KnowledgeEntry = {
  title: Localized;
  summary: Localized;
  tags: string[];
  url?: string;
};

export type Experience = {
  company: string;
  position: string;
  period: Localized;
  highlights: Localized<string[]>;
  stack: string[];
};

const DEVELOP_AND_MAINTAIN: Localized = { en: "Develop and maintain", ja: "開発・保守", vi: "Phát triển và bảo trì" };

export const PROFILE = {
  name: "Nguyen Trung Huy",
  title: { en: "Front-End Developer", ja: "フロントエンドエンジニア", vi: "Front-End Developer" } satisfies Localized,
  tagline: {
    en: "7+ years building complex web experiences for Japanese clients with React, Next.js, Vue and Nuxt.",
    ja: "React、Next.js、Vue、Nuxt を用いて、日本のクライアント向けに7年以上Webサイトを開発しています。",
    vi: "Hơn 7 năm xây dựng các trải nghiệm web phức tạp cho khách hàng Nhật Bản với React, Next.js, Vue và Nuxt.",
  } satisfies Localized,
  about: {
    en: "I build and maintain production websites for large Japanese clients, extend Contentful CMS, run CI/CD pipelines on GitHub, and craft interactive UI with GSAP and Three.js. Currently growing toward Fullstack development.",
    ja: "日本の大手クライアントの本番Webサイトの開発・保守、Contentful CMS の拡張、GitHub での CI/CD パイプライン運用、GSAP と Three.js によるインタラクティブな UI 制作を担当しています。現在はフルスタック開発へのスキル拡大に取り組んでいます。",
    vi: "Tôi phát triển và bảo trì các website production cho những khách hàng lớn tại Nhật Bản, mở rộng Contentful CMS, vận hành CI/CD pipeline trên GitHub và xây dựng UI tương tác với GSAP, Three.js. Hiện tôi đang phát triển theo hướng Fullstack.",
  } satisfies Localized,
  email: "trunghuy1701@gmail.com",
  github: "https://github.com/vipga195",
  linkedin: "https://www.linkedin.com/in/huy-nguyen-trung-950b02437/",
  cvUrl: "/CV_NGUYEN_TRUNG_HUY_FRONTEND_ATS.pdf",
};

export const SKILLS: SkillGroup[] = [
  {
    title: { en: "Frontend", ja: "フロントエンド", vi: "Frontend" },
    items: ["React", "Next.js", "Vue.js", "Nuxt.js", "Vite", "React Native", "Tailwind CSS", "SASS"],
  },
  { title: { en: "Animation & 3D", ja: "アニメーション・3D", vi: "Animation & 3D" }, items: ["GSAP", "Three.js", "Animate.js"] },
  {
    title: { en: "CMS & Backend", ja: "CMS・バックエンド", vi: "CMS & Backend" },
    items: ["Contentful (custom extensions)", "Node.js", "RESTful API"],
  },
  {
    title: { en: "Quality & Performance", ja: "品質・パフォーマンス", vi: "Chất lượng & Hiệu năng" },
    items: ["SEO Optimization", "Accessibility (a11y)", "Performance Tuning"],
  },
  { title: { en: "Workflow", ja: "ワークフロー", vi: "Quy trình" }, items: ["GitHub Actions", "Git", "Agile / Scrum"] },
];

export const PROJECTS: Project[] = [
  {
    name: "DeNA Corporate Site",
    url: "https://dena.com",
    summary: {
      en: "Corporate website for DeNA. Front-end development, Contentful integration and UI animation.",
      ja: "DeNA のコーポレートサイト。フロントエンド開発、Contentful 連携、UI アニメーションを担当。",
      vi: "Website doanh nghiệp của DeNA. Phát triển front-end, tích hợp Contentful và UI animation.",
    },
    role: DEVELOP_AND_MAINTAIN,
    teamSize: 8,
    stack: ["Next.js", "Contentful", "GSAP", "GitHub Actions"],
    media: {
      type: "video",
      src: "/projects/dena.mp4",
      poster: "/projects/dena-poster.jpg",
      alt: { en: "DeNA corporate site scroll demo", ja: "DeNA コーポレートサイトのスクロールデモ", vi: "Demo cuộn trang website DeNA" },
    },
  },
  {
    name: "GO Inc.",
    url: "https://go.goinc.jp",
    summary: {
      en: "Marketing site for GO Inc. with rich interactive sections.",
      ja: "インタラクティブなセクションを多数備えた GO株式会社 のマーケティングサイト。",
      vi: "Website marketing của GO Inc. với nhiều section tương tác.",
    },
    role: DEVELOP_AND_MAINTAIN,
    teamSize: 5,
    stack: ["Next.js", "GSAP"],
    media: {
      type: "video",
      src: "/projects/go.mp4",
      poster: "/projects/go-poster.jpg",
      alt: { en: "GO Inc. site scroll animation demo", ja: "GO株式会社 サイトのスクロールアニメーションデモ", vi: "Demo animation khi cuộn website GO Inc." },
    },
  },
  {
    name: "Wonderia",
    url: "https://wonderia.jp",
    summary: {
      en: "Brand site featuring animation and 3D interactions.",
      ja: "アニメーションと 3D インタラクションを特徴とするブランドサイト。",
      vi: "Website thương hiệu với animation và tương tác 3D.",
    },
    role: DEVELOP_AND_MAINTAIN,
    teamSize: 2,
    stack: ["Vite", "Three.js", "GSAP"],
    media: {
      type: "video",
      src: "/projects/wonderia.mp4",
      poster: "/projects/wonderia-poster.jpg",
      alt: { en: "Wonderia site interaction demo", ja: "Wonderia サイトのインタラクションデモ", vi: "Demo tương tác website Wonderia" },
    },
  },
  {
    name: "DeNA AI Link",
    url: "https://dena-ailink.com",
    summary: {
      en: "Service site for DeNA AI Link.",
      ja: "DeNA AI Link のサービスサイト。",
      vi: "Website dịch vụ của DeNA AI Link.",
    },
    role: DEVELOP_AND_MAINTAIN,
    teamSize: 2,
    stack: ["Next.js", "Contentful"],
    media: {
      type: "video",
      src: "/projects/dena-ailink.mp4",
      poster: "/projects/dena-ailink.webp",
      alt: { en: "DeNA AI Link site scroll demo", ja: "DeNA AI Link サイトのスクロールデモ", vi: "Demo cuộn trang website DeNA AI Link" },
    },
  },
  {
    name: "DeNA Alumni",
    url: "https://alumni.dena.com",
    summary: {
      en: "Alumni community site for DeNA.",
      ja: "DeNA のアルムナイ（退職者）コミュニティサイト。",
      vi: "Website cộng đồng cựu nhân viên (alumni) của DeNA.",
    },
    role: DEVELOP_AND_MAINTAIN,
    teamSize: 3,
    stack: ["Nuxt.js"],
    media: {
      type: "video",
      src: "/projects/dena-alumni.mp4",
      poster: "/projects/dena-alumni.webp",
      alt: { en: "DeNA Alumni site scroll demo", ja: "DeNA Alumni サイトのスクロールデモ", vi: "Demo cuộn trang website DeNA Alumni" },
    },
  },
  {
    name: "DeNA Games Tokyo",
    url: "https://denagames-tokyo.com",
    summary: {
      en: "Corporate and recruiting site for DeNA Games Tokyo, the game operations company behind titles such as Pokémon Masters.",
      ja: "『ポケモンマスターズ』などのゲーム運営を手がける DeNA Games Tokyo のコーポレート・採用サイト。",
      vi: "Website doanh nghiệp và tuyển dụng của DeNA Games Tokyo, công ty vận hành các tựa game như Pokémon Masters.",
    },
    role: {
      en: "Development, maintenance, QC and CI/CD",
      ja: "開発・保守・QC・CI/CD",
      vi: "Phát triển, bảo trì, QC và CI/CD",
    },
    teamSize: 3,
    stack: ["Next.js", "GSAP", "GitHub Actions"],
    media: {
      type: "video",
      src: "/projects/denagames-tokyo.mp4",
      poster: "/projects/denagames-tokyo-poster.jpg",
      alt: { en: "DeNA Games Tokyo site scroll demo", ja: "DeNA Games Tokyo サイトのスクロールデモ", vi: "Demo cuộn trang website DeNA Games Tokyo" },
    },
  },
];

export const EXPERIENCES: Experience[] = [
  {
    company: "Gianty Vietnam",
    position: "Front-End Developer",
    period: { en: "01/2022 – Present", ja: "2022年1月 – 現在", vi: "01/2022 – Hiện tại" },
    highlights: {
      en: [
        "Develop and maintain front-end for Japanese client projects",
        "Extend and customize Contentful CMS",
        "Build and maintain CI/CD pipelines with GitHub",
        "Maintain and develop Node.js services",
        "Build UI animation with GSAP, Three.js, Animate.js",
      ],
      ja: [
        "日本のクライアント案件のフロントエンド開発・保守",
        "Contentful CMS の拡張・カスタマイズ",
        "GitHub での CI/CD パイプラインの構築・保守",
        "Node.js サービスの開発・保守",
        "GSAP、Three.js、Animate.js による UI アニメーション制作",
      ],
      vi: [
        "Phát triển và bảo trì front-end cho các dự án của khách hàng Nhật Bản",
        "Mở rộng và tùy biến Contentful CMS",
        "Xây dựng và bảo trì CI/CD pipeline trên GitHub",
        "Phát triển và bảo trì các service Node.js",
        "Xây dựng UI animation với GSAP, Three.js, Animate.js",
      ],
    },
    stack: ["Next.js", "Nuxt.js", "Vite", "Node.js", "GSAP", "Three.js"],
  },
  {
    company: "Minerva Solution",
    position: "Front-End Developer",
    period: { en: "08/2020 – 12/2021", ja: "2020年8月 – 2021年12月", vi: "08/2020 – 12/2021" },
    highlights: {
      en: [
        "Built Sale Admin, CCTV App, Platform Workflow and Internet Banking (Vue.js)",
        "Sliced responsive layouts and coordinated API/JSON contracts with back-end team",
      ],
      ja: [
        "Sale Admin、CCTV アプリ、Platform Workflow、インターネットバンキングを開発（Vue.js）",
        "レスポンシブレイアウトのコーディング、バックエンドチームとの API/JSON 仕様の調整",
      ],
      vi: [
        "Xây dựng Sale Admin, CCTV App, Platform Workflow và Internet Banking (Vue.js)",
        "Cắt layout responsive và thống nhất API/JSON contract với team back-end",
      ],
    },
    stack: ["React.js", "Vue.js", "SASS", "jQuery"],
  },
  {
    company: "Thien Duong Cong Nghe",
    position: "Front-End Developer",
    period: { en: "05/2019 – 08/2020", ja: "2019年5月 – 2020年8月", vi: "05/2019 – 08/2020" },
    highlights: {
      en: ["Fixxy Admin Web with React.js + Ant Design", "Emartmall and ERP mobile apps with React Native"],
      ja: ["React.js + Ant Design による Fixxy 管理画面", "React Native による Emartmall・ERP モバイルアプリ"],
      vi: ["Fixxy Admin Web với React.js + Ant Design", "Ứng dụng di động Emartmall và ERP với React Native"],
    },
    stack: ["React.js", "React Native", "Redux Saga"],
  },
];

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  {
    title: {
      en: "Building Contentful App Framework extensions",
      ja: "Contentful App Framework による拡張機能の開発",
      vi: "Xây dựng extension với Contentful App Framework",
    },
    summary: {
      en: "Custom field editors and sidebar apps that make content editing faster and safer for editors.",
      ja: "カスタムフィールドエディタやサイドバーアプリで、編集者のコンテンツ編集をより速く安全にします。",
      vi: "Custom field editor và sidebar app giúp biên tập nội dung nhanh hơn và an toàn hơn.",
    },
    tags: ["Contentful", "React"],
  },
  {
    title: {
      en: "GSAP ScrollTrigger in React / Next.js",
      ja: "React / Next.js での GSAP ScrollTrigger",
      vi: "GSAP ScrollTrigger trong React / Next.js",
    },
    summary: {
      en: "Scoping animations with useGSAP, cleanup on unmount and respecting prefers-reduced-motion.",
      ja: "useGSAP によるアニメーションのスコープ管理、アンマウント時のクリーンアップ、prefers-reduced-motion への対応。",
      vi: "Giới hạn phạm vi animation với useGSAP, cleanup khi unmount và tôn trọng prefers-reduced-motion.",
    },
    tags: ["GSAP", "Next.js"],
  },
  {
    title: {
      en: "Three.js performance on marketing sites",
      ja: "マーケティングサイトにおける Three.js のパフォーマンス",
      vi: "Hiệu năng Three.js trên website marketing",
    },
    summary: {
      en: "Client-only canvas, capped device pixel ratio and lightweight geometry to keep Core Web Vitals healthy.",
      ja: "クライアント専用の canvas、デバイスピクセル比の上限設定、軽量なジオメトリで Core Web Vitals を良好に保ちます。",
      vi: "Canvas chỉ render phía client, giới hạn device pixel ratio và geometry nhẹ để giữ Core Web Vitals tốt.",
    },
    tags: ["Three.js", "Performance"],
  },
  {
    title: {
      en: "CI/CD for front-end with GitHub Actions",
      ja: "GitHub Actions によるフロントエンドの CI/CD",
      vi: "CI/CD cho front-end với GitHub Actions",
    },
    summary: {
      en: "Lint, typecheck and build on every pull request before deploying.",
      ja: "デプロイ前に、すべてのプルリクエストで lint・型チェック・ビルドを実行します。",
      vi: "Chạy lint, typecheck và build trên mọi pull request trước khi deploy.",
    },
    tags: ["GitHub Actions", "CI/CD"],
  },
];
