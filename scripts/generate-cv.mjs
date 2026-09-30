import path from "node:path";
import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToFile, Font } from "@react-pdf/renderer";
import fs from "node:fs";
import { PROFILE, SKILLS, EXPERIENCES } from "../src/data/profile.ts";

const e = React.createElement;

const SECTION_LABELS = {
  en: { summary: "Summary", skills: "Skills", experience: "Experience", stack: "Stack", projects: "Key projects", education: "Education" },
  ja: { summary: "職務要約", skills: "スキル", experience: "職務経歴", stack: "技術", projects: "主なプロジェクト", education: "学歴" },
  vi: { summary: "Tóm tắt", skills: "Kỹ năng", experience: "Kinh nghiệm", stack: "Công nghệ", projects: "Dự án tiêu biểu", education: "Học vấn" },
};

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111111", backgroundColor: "#ffffff" },
  name: { fontSize: 22, fontWeight: 700, marginBottom: 2 },
  titleLine: { fontSize: 12, marginBottom: 4 },
  contactLine: { fontSize: 9, marginBottom: 14, color: "#333333" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    marginTop: 14,
    marginBottom: 6,
    textTransform: "uppercase",
    borderBottom: "1pt solid #999999",
    paddingBottom: 2,
    minPresenceAhead: 40,
  },
  paragraph: { fontSize: 10, marginBottom: 4, lineHeight: 1.4 },
  skillLine: { fontSize: 10, marginBottom: 3 },
  expHeader: { fontSize: 11, fontWeight: 700, marginTop: 8, marginBottom: 2, minPresenceAhead: 40 },
  bullet: { fontSize: 10, marginBottom: 2, paddingLeft: 10 },
  stackLine: { fontSize: 9, marginTop: 2, color: "#333333" },
  projectLabel: { fontSize: 9.5, fontWeight: 700, marginTop: 3, marginBottom: 1 },
  projectItem: { fontSize: 9, marginBottom: 1, paddingLeft: 18, color: "#222222" },
});

function CvDocument(props) {
  const labels = SECTION_LABELS[props.lang];

  // Build experience header from non-empty parts only
  function buildExpHeader(exp) {
    const parts = [];
    if (exp.company) parts.push(exp.company);
    if (exp.position) parts.push(exp.position);
    const header = parts.join(" — ");
    if (exp.period) return `${header} (${exp.period})`;
    return header;
  }

  return e(
    Document,
    null,
    e(
      Page,
      { size: "A4", style: props.lang === "ja" || props.lang === "vi" ? [styles.page, { fontFamily: "CvFont" }] : styles.page },
      e(Text, { style: styles.name }, props.profile.name),
      e(Text, { style: styles.titleLine }, props.profile.title),
      e(Text, { style: styles.contactLine }, [props.profile.email, props.profile.phone, props.profile.address, props.profile.portfolio, props.profile.github, props.profile.linkedin].filter(Boolean).join(" | ")),
      e(Text, { style: styles.sectionTitle }, labels.summary),
      e(Text, { style: styles.paragraph }, props.profile.about),
      e(Text, { style: styles.sectionTitle }, labels.skills),
      ...props.skills.map((group, i) =>
        e(Text, { key: `skill-${i}`, style: styles.skillLine }, `${group.title}: ${group.items.join(", ")}`)
      ),
      e(Text, { style: styles.sectionTitle }, labels.experience),
      ...props.experiences.map((exp, i) => {
        const elements = [
          e(Text, { style: styles.expHeader }, buildExpHeader(exp)),
          ...exp.highlights.map((h, j) => e(Text, { key: `exp-${i}-h-${j}`, style: styles.bullet }, `• ${h}`)),
        ];

        // Skip stack line when empty
        if (exp.stack && exp.stack.length > 0) {
          elements.push(e(Text, { style: styles.stackLine }, `${labels.stack}: ${exp.stack.join(", ")}`));
        }

        // Add projects section if present
        if (exp.projects && exp.projects.length > 0) {
          // Keep the project list on one page; "–" exists in Helvetica (WinAnsi), "◦" does not
          elements.push(e(View, { key: `exp-${i}-projects`, wrap: false },
            e(Text, { style: styles.projectLabel }, labels.projects),
            ...exp.projects.map((p, pIdx) => e(Text, { key: `exp-${i}-p-${pIdx}`, style: styles.projectItem }, `– ${p}`))
          ));
        }

        return e(View, { key: `exp-${i}` }, ...elements);
      }),
      // Education section
      ...(props.education && props.education.length > 0 ? [
        e(Text, { style: styles.sectionTitle }, labels.education),
        ...props.education.map((edu, i) => {
          const educationElements = [];
          const headerText = edu.period ? `${edu.school} (${edu.period})` : edu.school;
          educationElements.push(e(Text, { key: `edu-${i}-h`, style: [styles.expHeader, { marginTop: 4 }] }, headerText));
          if (edu.major) {
            educationElements.push(e(Text, { key: `edu-${i}-m`, style: styles.paragraph }, edu.major));
          }
          return e(View, { key: `edu-${i}` }, ...educationElements);
        })
      ] : [])
    )
  );
}

function buildDataFromSource() {
  return {
    lang: "en",
    profile: {
      name: PROFILE.name,
      title: PROFILE.title.en,
      email: PROFILE.email,
      github: PROFILE.github,
      linkedin: PROFILE.linkedin,
      about: PROFILE.about.en,
    },
    skills: SKILLS.map(group => ({ title: group.title.en, items: group.items })),
    experiences: EXPERIENCES.map(exp => ({
      company: exp.company,
      position: exp.position,
      period: exp.period.en,
      highlights: exp.highlights.en,
      stack: exp.stack,
      projects: exp.projects || [],
    })),
    education: [],
  };
}

function loadJsonData(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);

  // Validate lang
  if (!["en", "ja", "vi"].includes(data.lang)) {
    throw new Error(`Invalid lang: ${data.lang}. Must be one of: en, ja, vi`);
  }

  // Validate profile
  if (!data.profile || typeof data.profile !== "object") {
    throw new Error("Missing or invalid 'profile' field");
  }

  // Validate and normalize skills
  if (!data.skills || !Array.isArray(data.skills)) {
    throw new Error("Missing or invalid 'skills' array");
  }
  data.skills.forEach((group, i) => {
    if (typeof group.title !== "string") {
      throw new Error(`skills[${i}].title must be a string`);
    }
    if (group.items === undefined) {
      group.items = [];
    } else if (!Array.isArray(group.items)) {
      throw new Error(`skills[${i}].items must be an array of strings`);
    }
    group.items.forEach((item, j) => {
      if (typeof item !== "string") {
        throw new Error(`skills[${i}].items[${j}] must be a string`);
      }
    });
  });

  // Validate and normalize experiences
  if (!data.experiences || !Array.isArray(data.experiences)) {
    throw new Error("Missing or invalid 'experiences' array");
  }
  data.experiences.forEach((exp, i) => {
    if (typeof exp.company !== "string") {
      throw new Error(`experiences[${i}].company must be a string`);
    }
    if (typeof exp.position !== "string") {
      throw new Error(`experiences[${i}].position must be a string`);
    }
    if (typeof exp.period !== "string") {
      throw new Error(`experiences[${i}].period must be a string`);
    }
    if (exp.highlights === undefined) {
      exp.highlights = [];
    } else if (!Array.isArray(exp.highlights)) {
      throw new Error(`experiences[${i}].highlights must be an array of strings`);
    }
    exp.highlights.forEach((h, j) => {
      if (typeof h !== "string") {
        throw new Error(`experiences[${i}].highlights[${j}] must be a string`);
      }
    });
    if (exp.stack === undefined) {
      exp.stack = [];
    } else if (!Array.isArray(exp.stack)) {
      throw new Error(`experiences[${i}].stack must be an array of strings`);
    }
    exp.stack.forEach((s, j) => {
      if (typeof s !== "string") {
        throw new Error(`experiences[${i}].stack[${j}] must be a string`);
      }
    });
    if (exp.projects === undefined) {
      exp.projects = [];
    } else if (!Array.isArray(exp.projects)) {
      throw new Error(`experiences[${i}].projects must be an array of strings`);
    }
    if (Array.isArray(exp.projects)) {
      exp.projects.forEach((p, j) => {
        if (typeof p !== "string") {
          throw new Error(`experiences[${i}].projects[${j}] must be a string`);
        }
      });
    }
  });

  // Validate and normalize education (optional)
  if (data.education !== undefined && !Array.isArray(data.education)) {
    throw new Error("education must be an array");
  }
  if (data.education) {
    data.education.forEach((edu, i) => {
      if (typeof edu.school !== "string") {
        throw new Error(`education[${i}].school must be a string`);
      }
      if (typeof edu.major !== "string") {
        throw new Error(`education[${i}].major must be a string`);
      }
      if (edu.period === undefined) {
        edu.period = "";
      } else if (typeof edu.period !== "string") {
        throw new Error(`education[${i}].period must be a string`);
      }
    });
  }

  // Initialize education if not provided
  if (!data.education) {
    data.education = [];
  }

  return data;
}

function registerFontsForLang(lang) {
  if (lang === "en") return; // Use default Helvetica

  const fontDir = path.join(import.meta.dirname, "fonts");
  const fonts = lang === "ja"
    ? [
        { name: "regular", path: path.join(fontDir, "NotoSansJP-Regular.ttf") },
        { name: "bold", path: path.join(fontDir, "NotoSansJP-Bold.ttf") },
      ]
    : lang === "vi"
    ? [
        { name: "regular", path: path.join(fontDir, "BeVietnamPro-Regular.ttf") },
        { name: "bold", path: path.join(fontDir, "BeVietnamPro-Bold.ttf") },
      ]
    : [];

  for (const font of fonts) {
    if (!fs.existsSync(font.path)) {
      throw new Error(`Font file not found: ${font.path}`);
    }
  }

  Font.register({
    family: "CvFont",
    fonts: [
      { src: fonts[0].path },
      { src: fonts[1].path, fontWeight: 700 },
    ],
  });

  // Register hyphenation callback for Japanese text
  if (lang === "ja") {
    Font.registerHyphenationCallback((word) => (/[　-鿿＀-￯]/.test(word) ? Array.from(word) : [word]));
  }
}

async function main() {
  const args = process.argv.slice(2);

  let data;
  let outPath;

  if (args.length === 0) {
    // Default behavior: use profile.ts
    data = buildDataFromSource();
    outPath = path.join(process.cwd(), "public", "CV_NGUYEN_TRUNG_HUY_FRONTEND_ATS.pdf");
  } else {
    // JSON mode
    const jsonPath = args[0];
    data = loadJsonData(jsonPath);

    // Determine output path
    if (args[1]) {
      outPath = args[1];
    } else {
      const jsonDir = path.dirname(jsonPath);
      outPath = path.join(jsonDir, "cv.pdf");
    }
  }

  // Register fonts if needed
  registerFontsForLang(data.lang);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Render
  await renderToFile(e(CvDocument, data), outPath);
  console.log(`CV PDF generated at ${outPath}`);
}

main();
