// Who submitted a game, WITHOUT keeping their IP address. Server-only (node:crypto).
import { createHmac } from "node:crypto";

import { deriveKey } from "./keys.ts";

const SOURCE_KEY_PURPOSE = "snake-source";
const SOURCE_HASH_CHARS = 16;

// One-way, keyed (HMAC) and truncated: stable between days so a source can be limited per batch, but the IP cannot be
// recovered from it without the secret
export function sourceHash(ip: string, secret: string): string {
  return createHmac("sha256", deriveKey(secret, SOURCE_KEY_PURPOSE)).update(ip).digest("hex").slice(0, SOURCE_HASH_CHARS);
}
