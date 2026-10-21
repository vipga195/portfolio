// Public learning API as plain functions (request, deps) -> Response, so they can be unit-tested without Next.js.
// The route files in src/app/api/learning only wire real dependencies (server-deps.ts) and call these.
// The secret is passed in by the wiring layer; nothing here reads the environment.
import { MAX_GRID_SIZE, MIN_GRID_SIZE } from "../game/snake.ts";
import { SITE_URL } from "../site.ts";
import { clientKeyFromRequest } from "../training/api.ts";
import type { Limiter } from "../training/limiter.ts";
import type { SubmissionStore } from "../training/submissions.ts";
import type { LearningConfig } from "./config.ts";
import { createSession, verifySessionToken } from "./session.ts";
import { sourceHash } from "./source.ts";
import { MAX_SUBMISSION_BYTES, parseSubmission, validateMovesShape } from "./submission.ts";

export type LearningDeps = {
  store: SubmissionStore;
  config: LearningConfig;
  limiter: Limiter;
  // Server-only secret for session tokens and source hashes
  secret: string;
  // Milliseconds since the epoch
  now: () => number;
};

const GAME = "snake";
const SESSION_BODY_MAX_BYTES = 256;
const MINUTE_MS = 60_000;
const CACHE_SHORT = "public, max-age=2, s-maxage=2, stale-while-revalidate=5";
const NO_STORE = "no-store";

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": NO_STORE, ...headers } });
}

function disabled(): Response {
  return json({ error: "learning_disabled" }, 404);
}

function serverError(error: unknown): Response {
  // Internals stay in the server log
  console.error("learning api error:", error);
  return json({ error: "server_error" }, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Same-origin check: this only stops cross-site browser abuse of an anonymous public API, not direct callers
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  return origin === new URL(request.url).origin || origin === new URL(SITE_URL).origin;
}

const TOO_LARGE: unique symbol = Symbol("too_large");

// Counts the bytes actually read, so a lying or missing Content-Length cannot get past the limit
async function readBody(request: Request, maxBytes: number): Promise<string | typeof TOO_LARGE> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return TOO_LARGE;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

type Kind = "session" | "games" | "brain";

// One atomic check of the per-client and the global budget: a denied request charges neither
function throttled(deps: LearningDeps, kind: Kind, clientKey: string): Response | null {
  const { rates } = deps.config;
  const rule = {
    session: { client: rates.sessionPerClient, global: rates.sessionGlobal },
    games: { client: rates.gamesPerClient, global: rates.gamesGlobal },
    brain: { client: rates.brainPerClient, global: rates.brainGlobal },
  }[kind];
  const result = deps.limiter.consume(
    { key: `learning:${kind}:client:${clientKey}`, rule: { max: rule.client, windowMs: MINUTE_MS } },
    { name: `learning:${kind}:global`, rule: { max: rule.global, windowMs: MINUTE_MS } },
  );
  if (result.allowed) return null;
  return json({ error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds }, 429, { "Retry-After": String(result.retryAfterSeconds) });
}

// Shared by the two POST handlers: origin, declared size, content type. Null = fine.
function checkPostHeaders(request: Request, maxBytes: number): Response | null {
  if (!originAllowed(request)) return json({ error: "forbidden_origin" }, 403);
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return json({ error: "payload_too_large" }, 413);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return json({ error: "unsupported_media_type" }, 415);
  return null;
}

// Reads and parses the JSON body; the Response is the failure
async function readJson(request: Request, maxBytes: number): Promise<{ body: unknown } | { response: Response }> {
  const text = await readBody(request, maxBytes);
  if (text === TOO_LARGE) return { response: json({ error: "payload_too_large" }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { response: json({ error: "invalid_body" }, 400) };
  }
}

// ---- POST /api/learning/session ----

export async function createSessionHandler(request: Request, deps: LearningDeps): Promise<Response> {
  if (!deps.config.enabled) return disabled();
  try {
    const rejected = checkPostHeaders(request, SESSION_BODY_MAX_BYTES);
    if (rejected) return rejected;
    const clientKey = clientKeyFromRequest(request);
    const limited = throttled(deps, "session", clientKey);
    if (limited) return limited;

    const parsed = await readJson(request, SESSION_BODY_MAX_BYTES);
    if ("response" in parsed) return parsed.response;
    const { body } = parsed;
    if (!isRecord(body)) return json({ error: "invalid_body" }, 400);
    const { gridSize } = body;
    if (typeof gridSize !== "number" || !Number.isInteger(gridSize) || gridSize < MIN_GRID_SIZE || gridSize > MAX_GRID_SIZE) {
      return json({ error: "invalid_field", field: "gridSize" }, 400);
    }
    const { session, token } = createSession(gridSize, Math.floor(deps.now() / 1000), deps.secret);
    return json({ token, gridSize: session.gridSize, seed: session.seed }, 200);
  } catch (error) {
    return serverError(error);
  }
}

// ---- POST /api/learning/games ----

export async function submitGame(request: Request, deps: LearningDeps): Promise<Response> {
  if (!deps.config.enabled) return disabled();
  try {
    const rejected = checkPostHeaders(request, MAX_SUBMISSION_BYTES);
    if (rejected) return rejected;
    const clientKey = clientKeyFromRequest(request);
    const limited = throttled(deps, "games", clientKey);
    if (limited) return limited;

    const parsedBody = await readJson(request, MAX_SUBMISSION_BYTES);
    if ("response" in parsedBody) return parsedBody.response;
    const submission = parseSubmission(parsedBody.body);
    if (!submission.ok) return json({ error: "invalid_body" }, 400);
    const { token, moves } = submission.value;

    // The replay itself happens later in the trainer, never in the request
    const verified = verifySessionToken(token, deps.secret, Math.floor(deps.now() / 1000));
    if (!verified.ok) {
      return json({ error: verified.reason === "token expired" ? "token_expired" : "invalid_token" }, 401);
    }
    const { session } = verified;
    if (!validateMovesShape(moves, session.gridSize).ok) return json({ error: "invalid_moves" }, 400);

    const result = await deps.store.addWithQuota(
      { game: GAME, variant: String(session.gridSize), seed: session.seed, moves, sourceHash: sourceHash(clientKey, deps.secret) },
      deps.config.limits,
    );
    if (result.ok) return json({ ok: true }, 202);
    if (result.reason === "duplicate_seed") return json({ error: "duplicate_seed" }, 409);
    const retryAfterSeconds = result.reason === "queue_full" ? 60 : 3600;
    return json({ error: result.reason, retryAfterSeconds }, 429, { "Retry-After": String(retryAfterSeconds) });
  } catch (error) {
    return serverError(error);
  }
}

// ---- GET /api/learning/brain ----

export async function getBrain(request: Request, deps: LearningDeps): Promise<Response> {
  if (!deps.config.enabled) return disabled();
  try {
    const limited = throttled(deps, "brain", clientKeyFromRequest(request));
    if (limited) return limited;
    const raw = new URL(request.url).searchParams.get("featuresVersion");
    const requested = raw !== null && /^[0-9]{1,9}$/.test(raw) ? Number(raw) : null;
    if (requested === null) return json({ error: "invalid_field", field: "featuresVersion" }, 400);

    const published = await deps.store.getPublished(GAME);
    // A brain made for other features would misread the board: the client falls back to its static file
    if (!published || published.featuresVersion !== requested) return json({ error: "no_published_brain" }, 404);
    return json(
      { brain: published.data, featuresVersion: published.featuresVersion, brainId: published.brainId, publishedAt: published.publishedAt.toISOString() },
      200,
      { "Cache-Control": CACHE_SHORT },
    );
  } catch (error) {
    return serverError(error);
  }
}
