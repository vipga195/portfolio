"use client";

import { useRef, useState } from "react";

import type { ContactFormLabels } from "@/i18n/dictionary";
import { HONEYPOT_FIELD } from "@/lib/contact";
import type { Locale } from "@/i18n/config";

type Status = "idle" | "sending" | "success" | "error" | "rate_limited" | "invalid";

type FormProps = {
  lang: Locale;
  labels: ContactFormLabels;
};

export default function ContactForm({ lang, labels }: FormProps): React.JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>("idle");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setStatus("sending");

    const formData = new FormData(event.currentTarget);
    const input = {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      message: String(formData.get("message") ?? ""),
      locale: lang,
      [HONEYPOT_FIELD]: String(formData.get(HONEYPOT_FIELD) ?? ""),
    };

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (response.ok) {
        setStatus("success");
        if (formRef.current) {
          formRef.current.reset();
        }
      } else {
        let nextStatus: Status = "error";
        try {
          const data: unknown = await response.json();
          if (response.status === 429) {
            nextStatus = "rate_limited";
          } else if (typeof data === "object" && data !== null && "error" in data && data.error === "invalid_field") {
            nextStatus = "invalid";
          }
        } catch {
          nextStatus = "error";
        }
        setStatus(nextStatus);
      }
    } catch {
      setStatus("error");
    }
  };

  const statusColor =
    status === "success"
      ? "text-green-500"
      : status === "rate_limited"
        ? "text-yellow-500"
        : status === "error" || status === "invalid"
          ? "text-red-500"
          : "";

  const statusText =
    status === "success"
      ? labels.success
      : status === "error"
        ? labels.error
        : status === "rate_limited"
          ? labels.rateLimited
          : status === "invalid"
            ? labels.invalid
            : "";

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label htmlFor="contact-name" className="block text-sm font-medium text-neutral-200 mb-2">
          {labels.name}
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          required
          maxLength={100}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-500 focus:border-blue-500 outline-none"
          placeholder={labels.name}
        />
      </div>

      <div>
        <label htmlFor="contact-email" className="block text-sm font-medium text-neutral-200 mb-2">
          {labels.email}
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          required
          maxLength={254}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-500 focus:border-blue-500 outline-none"
          placeholder={labels.email}
        />
      </div>

      <div>
        <label htmlFor="contact-message" className="block text-sm font-medium text-neutral-200 mb-2">
          {labels.message}
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-neutral-100 placeholder-neutral-500 focus:border-blue-500 outline-none resize-none"
          placeholder={labels.message}
        />
      </div>

      <input
        name={HONEYPOT_FIELD}
        type="text"
        className="absolute left-[-9999px]"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
      />

      <button
        type="submit"
        disabled={status === "sending"}
        className="rounded-full bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {status === "sending" ? labels.sending : labels.submit}
      </button>

      <p role="status" aria-live="polite" className={`text-sm ${statusColor}`}>
        {statusText}
      </p>
    </form>
  );
}
