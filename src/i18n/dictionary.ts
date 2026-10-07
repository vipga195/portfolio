import type { Localized } from "./config";

export type ContactFormLabels = {
  name: string;
  email: string;
  company: string;
  message: string;
  submit: string;
  sending: string;
  success: string;
  error: string;
  rateLimited: string;
  invalid: string;
};

export type Dictionary = {
  meta: { title: string; description: string };
  nav: { about: string; skills: string; projects: string; experience: string; knowledge: string; contact: string };
  hero: { greeting: string; viewWork: string; downloadCv: string };
  sections: { about: string; skills: string; projects: string; experience: string; knowledgeBase: string; contact: string };
  teamOf: (size: number) => string;
  contactText: string;
  contactForm: ContactFormLabels;
  languageLabel: string;
  menuLabel: string;
  closeMenuLabel: string;
};

export const DICTIONARIES: Localized<Dictionary> = {
  en: {
    meta: {
      title: "Nguyen Trung Huy — Front-End Engineer (React / Next.js)",
      description:
        "Front-End Developer with 7+ years of experience, many of them building websites for large Japanese clients with React, Next.js, Vue, Nuxt, GSAP and Three.js.",
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
    contactText: "Looking for Front-End roles. Also open to Fullstack opportunities — feel free to reach out. Based in Vietnam, working remotely with Japanese clients via a Vietnam-based company. Working language: English.",
    contactForm: {
      name: "Name",
      email: "Email",
      company: "Company (optional)",
      message: "Message",
      submit: "Send Message",
      sending: "Sending...",
      success: "Message sent successfully! Thank you for reaching out.",
      error: "An error occurred. Please try again.",
      rateLimited: "Too many requests. Please try again later.",
      invalid: "Please check your input and try again.",
    },
    languageLabel: "Language",
    menuLabel: "Menu",
    closeMenuLabel: "Close menu",
  },
  ja: {
    meta: {
      title: "Nguyen Trung Huy — フロントエンドエンジニア（React / Next.js）",
      description:
        "React、Next.js、Vue、Nuxt、GSAP、Three.js を用いて、日本の大手クライアント向けに長年Webサイトの開発・保守を行っている、開発経験7年以上のフロントエンドエンジニア。",
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
    contactText: "フロントエンド職を希望しています。フルスタックのポジションも歓迎します。お気軽にご連絡ください。ベトナム在住、ベトナムの会社を通じて日本のクライアントとリモートで業務を行っています。業務言語：英語。",
    contactForm: {
      name: "お名前",
      email: "メールアドレス",
      company: "会社名（任意）",
      message: "メッセージ",
      submit: "送信する",
      sending: "送信中...",
      success: "メッセージが正常に送信されました。ご連絡ありがとうございます。",
      error: "エラーが発生しました。もう一度お試しください。",
      rateLimited: "リクエストが多すぎます。後でもう一度お試しください。",
      invalid: "入力内容を確認してもう一度お試しください。",
    },
    languageLabel: "言語",
    menuLabel: "メニュー",
    closeMenuLabel: "メニューを閉じる",
  },
  vi: {
    meta: {
      title: "Nguyễn Trung Huy — Front-End Engineer (React / Next.js)",
      description:
        "Front-End Developer với hơn 7 năm kinh nghiệm, trong đó nhiều năm xây dựng website cho các khách hàng lớn tại Nhật Bản bằng React, Next.js, Vue, Nuxt, GSAP và Three.js.",
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
    contactText: "Đang tìm vị trí Front-End. Cũng sẵn sàng nhận vị trí Fullstack — hãy liên hệ với tôi. Sống tại Việt Nam, làm việc remote với khách hàng Nhật thông qua công ty tại Việt Nam. Ngôn ngữ làm việc: tiếng Anh.",
    contactForm: {
      name: "Tên của bạn",
      email: "Email",
      company: "Công ty (không bắt buộc)",
      message: "Tin nhắn",
      submit: "Gửi tin nhắn",
      sending: "Đang gửi...",
      success: "Tin nhắn đã được gửi thành công. Cảm ơn bạn đã liên hệ.",
      error: "Có lỗi xảy ra. Vui lòng thử lại.",
      rateLimited: "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
      invalid: "Vui lòng kiểm tra thông tin và thử lại.",
    },
    languageLabel: "Ngôn ngữ",
    menuLabel: "Menu",
    closeMenuLabel: "Đóng menu",
  },
};
