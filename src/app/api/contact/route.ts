import { createHash } from "node:crypto";

import { getPool } from "@/lib/db";
import { sendContactNotification } from "@/lib/mailer";
import { isRateLimited } from "@/lib/rateLimit";
import { HONEYPOT_FIELD, parseContact } from "@/lib/contact";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const ipHeader = request.headers.get("x-forwarded-for");
  const ip = ipHeader ? ipHeader.split(",")[0].trim() : request.headers.get("x-real-ip") ?? "unknown";

  if (isRateLimited(ip)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  if (typeof body === "object" && body !== null) {
    // object narrowed to non-null, safe to cast to Record
    const honeypot = (body as Record<string, unknown>)[HONEYPOT_FIELD];
    if (typeof honeypot === "string" && honeypot.trim().length > 0) {
      return Response.json({ ok: true }, { status: 200 });
    }
  }

  const parseResult = parseContact(body);
  if (!parseResult.ok) {
    return Response.json({ error: "invalid_field", field: parseResult.field }, { status: 400 });
  }

  const ipHash = createHash("sha256").update(ip).digest("hex");
  const { name, email, message, locale } = parseResult.data;

  const pool = getPool();
  try {
    await pool.query(
      "INSERT INTO contact_messages (name, email, message, locale, ip_hash) VALUES ($1, $2, $3, $4, $5)",
      [name, email, message, locale, ipHash],
    );
  } catch (error) {
    console.error("Database error:", error);
    return Response.json({ error: "server_error" }, { status: 500 });
  }

  try {
    await sendContactNotification(parseResult.data);
  } catch (error) {
    console.error("Email error:", error);
  }

  return Response.json({ ok: true }, { status: 201 });
}
