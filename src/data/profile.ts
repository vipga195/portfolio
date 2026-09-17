export type SkillGroup = {
  title: string;
  items: string[];
};

export type Project = {
  name: string;
  url?: string;
  summary: string;
  role: string;
  teamSize: number;
  stack: string[];
};

export type Experience = {
  company: string;
  position: string;
  period: string;
  highlights: string[];
  stack: string[];
};

export const PROFILE = {
  name: "Nguyen Trung Huy",
  title: "Front-End Developer",
  tagline:
    "7+ years building complex web experiences for Japanese clients with React, Next.js, Vue and Nuxt.",
  about:
    "I build and maintain production websites for large Japanese clients, extend Contentful CMS, run CI/CD pipelines on GitHub, and craft interactive UI with GSAP and Three.js. Currently growing toward Fullstack development.",
  email: "trunghuy1701@gmail.com",
  github: "https://github.com/",
  linkedin: "https://www.linkedin.com/",
  cvUrl: "/CV_NGUYEN_TRUNG_HUY_FRONTEND_ATS.pdf",
};

export const SKILLS: SkillGroup[] = [
  {
    title: "Frontend",
    items: ["React", "Next.js", "Vue.js", "Nuxt.js", "Vite", "React Native", "Tailwind CSS", "SASS"],
  },
  { title: "Animation & 3D", items: ["GSAP", "Three.js", "Animate.js"] },
  { title: "CMS & Backend", items: ["Contentful (custom extensions)", "Node.js", "RESTful API"] },
  { title: "Workflow", items: ["GitHub Actions", "Git", "Agile / Scrum"] },
];

export const PROJECTS: Project[] = [
  {
    name: "DeNA Corporate Site",
    url: "https://dena.com",
    summary: "Corporate website for DeNA. Front-end development, Contentful integration and UI animation.",
    role: "Develop and maintain",
    teamSize: 8,
    stack: ["Next.js", "Contentful", "GSAP", "GitHub Actions"],
  },
  {
    name: "GO Inc.",
    url: "https://go.goinc.jp",
    summary: "Marketing site for GO Inc. with rich interactive sections.",
    role: "Develop and maintain",
    teamSize: 5,
    stack: ["Next.js", "GSAP"],
  },
  {
    name: "Wonderia",
    url: "https://wonderia.jp",
    summary: "Brand site featuring animation and 3D interactions.",
    role: "Develop and maintain",
    teamSize: 2,
    stack: ["Vite", "Three.js", "GSAP"],
  },
  {
    name: "DeNA AI Link",
    url: "https://dena-ailink.com",
    summary: "Service site for DeNA AI Link.",
    role: "Develop and maintain",
    teamSize: 2,
    stack: ["Next.js", "Contentful"],
  },
  {
    name: "DeNA Alumni",
    url: "https://alumi.dena.com",
    summary: "Alumni community site for DeNA.",
    role: "Develop and maintain",
    teamSize: 3,
    stack: ["Nuxt.js"],
  },
];

export const EXPERIENCES: Experience[] = [
  {
    company: "Gianty Vietnam",
    position: "Front-End Developer",
    period: "01/2022 – Present",
    highlights: [
      "Develop and maintain front-end for Japanese client projects",
      "Extend and customize Contentful CMS",
      "Build and maintain CI/CD pipelines with GitHub",
      "Maintain and develop Node.js services",
      "Build UI animation with GSAP, Three.js, Animate.js",
    ],
    stack: ["Next.js", "Nuxt.js", "Vite", "Node.js", "GSAP", "Three.js"],
  },
  {
    company: "Minerva Solution",
    position: "Front-End Developer",
    period: "08/2020 – 12/2021",
    highlights: [
      "Built Sale Admin, CCTV App, Platform Workflow and Internet Banking (Vue.js)",
      "Sliced responsive layouts and coordinated API/JSON contracts with back-end team",
    ],
    stack: ["React.js", "Vue.js", "SASS", "jQuery"],
  },
  {
    company: "Thien Duong Cong Nghe",
    position: "Front-End Developer",
    period: "05/2019 – 08/2020",
    highlights: [
      "Fixxy Admin Web with React.js + Ant Design",
      "Emartmall and ERP mobile apps with React Native",
    ],
    stack: ["React.js", "React Native", "Redux Saga"],
  },
];
