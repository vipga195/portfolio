// Server-only (node:crypto): never import this from client code, the bundler would refuse it on purpose.
import { createHmac } from "node:crypto";

export const MIN_SECRET_LENGTH = 32;

// One secret, one derived key per purpose, so a key made for sessions can never be used as the key for sources.
// The secret is passed in by the caller (the routes read it from the environment), this library never reads env itself.
export function deriveKey(secret: string, purpose: string): Buffer {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`the secret must be a string of at least ${MIN_SECRET_LENGTH} characters`);
  }
  return createHmac("sha256", secret).update(purpose).digest();
}
