import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

import { PROFILE } from "@/data/profile";
import type { Localized } from "@/i18n/config";
import type { ContactMessage } from "./contact";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

function assertConfigured(): void {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP credentials are not configured");
  }
}

const THANK_YOU: Localized<{ subject: string; body: (name: string) => string }> = {
  en: {
    subject: `Thanks for reaching out — ${PROFILE.name}`,
    body: (name) =>
      `Hi ${name},\n\nThank you for your message. I have received it and will get back to you as soon as possible.\n\nBest regards,\n${PROFILE.name}`,
  },
  ja: {
    subject: `お問い合わせありがとうございます — ${PROFILE.name}`,
    body: (name) =>
      `${name} 様\n\nお問い合わせいただきありがとうございます。内容を確認のうえ、できるだけ早くご連絡いたします。\n\nよろしくお願いいたします。\n${PROFILE.name}`,
  },
  vi: {
    subject: `Cảm ơn bạn đã liên hệ — ${PROFILE.name}`,
    body: (name) =>
      `Xin chào ${name},\n\nCảm ơn bạn đã gửi tin nhắn. Tôi đã nhận được và sẽ phản hồi sớm nhất có thể.\n\nTrân trọng,\n${PROFILE.name}`,
  },
};

export async function sendContactNotification(msg: ContactMessage): Promise<void> {
  assertConfigured();

  const cleanName = msg.name.replace(/[\r\n]/g, "");
  const subject = `[Portfolio] New message from ${cleanName}`;
  const text = `Name: ${msg.name}\nEmail: ${msg.email}\nCompany: ${msg.company || "-"}\nLocale: ${msg.locale}\n\n${msg.message}`;

  await getTransporter().sendMail({
    from: process.env.SMTP_USER,
    to: process.env.CONTACT_TO || process.env.SMTP_USER,
    subject,
    text,
    replyTo: msg.email,
  });
}

export async function sendThankYou(msg: ContactMessage): Promise<void> {
  assertConfigured();

  const template = THANK_YOU[msg.locale];
  const cleanName = msg.name.replace(/[\r\n]/g, "");
  await getTransporter().sendMail({
    from: { name: PROFILE.name, address: process.env.SMTP_USER ?? "" },
    to: msg.email,
    subject: template.subject,
    text: template.body(cleanName),
  });
}
