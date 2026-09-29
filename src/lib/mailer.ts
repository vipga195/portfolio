import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

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

export async function sendContactNotification(msg: ContactMessage): Promise<void> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error("SMTP credentials are not configured");
  }

  const cleanName = msg.name.replace(/[\r\n]/g, "");
  const subject = `[Portfolio] New message from ${cleanName}`;
  const text = `Name: ${msg.name}\nEmail: ${msg.email}\nLocale: ${msg.locale}\n\n${msg.message}`;

  await getTransporter().sendMail({
    from: process.env.SMTP_USER,
    to: process.env.CONTACT_TO || process.env.SMTP_USER,
    subject,
    text,
    replyTo: msg.email,
  });
}
