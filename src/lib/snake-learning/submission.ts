// Cheap shape checks for a submitted game. Everything here is untrusted client input; the real verification
// (replaying the game) happens later in the trainer.
import { MAX_GRID_SIZE } from "../game/snake.ts";
import { maxMoves } from "../game/replay.ts";

export const MAX_TOKEN_CHARS = 200;
// Longest legal game for any grid size; used before the token (and so the grid size) has been verified
const MAX_MOVES_ANY_GRID = maxMoves(MAX_GRID_SIZE);
// Body size limit for the route: check it BEFORE parsing JSON. The longest legal game plus the token and JSON punctuation.
export const MAX_SUBMISSION_BYTES = MAX_MOVES_ANY_GRID + MAX_TOKEN_CHARS + 100;

const MOVES_PATTERN = /^[udlr]+$/;

export type Submission = { token: string; moves: string };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

// `body` is whatever JSON the client sent: nothing about its shape can be assumed
export function parseSubmission(body: unknown): ParseResult<Submission> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "body must be an object" };
  }
  const { token, moves } = body as Record<string, unknown>;   // each field is type-checked right below
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, reason: "invalid token" };
  }
  if (typeof moves !== "string") return { ok: false, reason: "invalid moves" };
  if (moves.length === 0 || moves.length > MAX_MOVES_ANY_GRID || !MOVES_PATTERN.test(moves)) {
    return { ok: false, reason: "invalid moves" };
  }
  return { ok: true, value: { token, moves } };
}

// Once the grid size is known (from the verified token) the length limit becomes exact
export function validateMovesShape(moves: string, gridSize: number): { ok: true } | { ok: false; reason: string } {
  if (moves.length === 0 || moves.length > maxMoves(gridSize)) return { ok: false, reason: "invalid number of moves" };
  if (!MOVES_PATTERN.test(moves)) return { ok: false, reason: "invalid moves" };
  return { ok: true };
}
