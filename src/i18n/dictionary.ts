import type { Localized } from "./config";

export type Dictionary = {
  meta: { title: string; description: string };
  nav: { about: string; skills: string; projects: string; experience: string; knowledge: string; contact: string };
  hero: { greeting: string; viewWork: string; downloadCv: string };
  sections: { about: string; skills: string; projects: string; experience: string; knowledgeBase: string; contact: string };
  teamOf: (size: number) => string;
  contactText: string;
  languageLabel: string;
  menuLabel: string;
  closeMenuLabel: string;
};

export const DICTIONARIES: Localized<Dictionary> = {
  en: {
    meta: {
      title: "Nguyen Trung Huy — Front-End Developer",
      description:
        "Front-End Developer with 7+ years of experience in React, Next.js, Vue, Nuxt, GSAP and Three.js.",
    },
    nav: {
      about: "About",
      skills: "Skills",
      projects: "Projects",
      experience: "Experience",
      knowledge: "Knowledge",
      contact: "Contact",
    },
    hero: { greeting: "Hi, I'm", viewWork: "View work", downloadCv: "Download CV" },
    sections: {
      about: "About",
      skills: "Skills",
      projects: "Featured Work",
      experience: "Experience",
      knowledgeBase: "Knowledge Base",
      contact: "Contact",
    },
    teamOf: (size) => `Team of ${size}`,
    contactText: "Open to Front-End / Fullstack opportunities. Feel free to reach out.",
    languageLabel: "Language",
    menuLabel: "Menu",
    closeMenuLabel: "Close menu",
  },
  ja: {
    meta: {
      title: "Nguyen Trung Huy — フロントエンドエンジニア",
      description:
        "React、Next.js、Vue、Nuxt、GSAP、Three.js を用いた開発経験7年以上のフロントエンドエンジニア。",
    },
    nav: {
      about: "概要",
      skills: "スキル",
      projects: "実績",
      experience: "職歴",
      knowledge: "ナレッジ",
      contact: "連絡先",
    },
    hero: { greeting: "はじめまして", viewWork: "実績を見る", downloadCv: "CVをダウンロード" },
    sections: {
      about: "概要",
      skills: "スキル",
      projects: "主な実績",
      experience: "職歴",
      knowledgeBase: "ナレッジベース",
      contact: "連絡先",
    },
    teamOf: (size) => `チーム ${size}名`,
    contactText: "フロントエンド／フルスタックのポジションを歓迎しています。お気軽にご連絡ください。",
    languageLabel: "言語",
    menuLabel: "メニュー",
    closeMenuLabel: "メニューを閉じる",
  },
  vi: {
    meta: {
      title: "Nguyễn Trung Huy — Front-End Developer",
      description:
        "Front-End Developer với hơn 7 năm kinh nghiệm React, Next.js, Vue, Nuxt, GSAP và Three.js.",
    },
    nav: {
      about: "Giới thiệu",
      skills: "Kỹ năng",
      projects: "Dự án",
      experience: "Kinh nghiệm",
      knowledge: "Kiến thức",
      contact: "Liên hệ",
    },
    hero: { greeting: "Xin chào, tôi là", viewWork: "Xem dự án", downloadCv: "Tải CV" },
    sections: {
      about: "Giới thiệu",
      skills: "Kỹ năng",
      projects: "Dự án tiêu biểu",
      experience: "Kinh nghiệm",
      knowledgeBase: "Kiến thức",
      contact: "Liên hệ",
    },
    teamOf: (size) => `Team ${size} người`,
    contactText: "Sẵn sàng cho các cơ hội Front-End / Fullstack. Hãy liên hệ với tôi.",
    languageLabel: "Ngôn ngữ",
    menuLabel: "Menu",
    closeMenuLabel: "Đóng menu",
  },
};
