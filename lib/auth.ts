import { createHmac, timingSafeEqual } from "crypto";

// Single shared-password gate. On successful login we set an httpOnly cookie
// containing a signed token (not the password). The token is an opaque,
// non-expiring marker HMAC'd with SESSION_SECRET, so a leaked cookie cannot be
// forged without the secret, and we never persist the raw password anywhere.

export const SESSION_COOKIE = "ccc_session";

// Constant payload — the cookie only needs to prove "this client passed the
// gate". There is one user, so there's no identity to encode.
const SESSION_PAYLOAD = "v1";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Value to store in the session cookie after a correct password. */
export function createSessionToken(): string {
  return `${SESSION_PAYLOAD}.${sign(SESSION_PAYLOAD)}`;
}

/** Verify a cookie value was produced by createSessionToken with our secret. */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(payload);
  return safeEqual(provided, expected) && payload === SESSION_PAYLOAD;
}

/** Constant-time password check against APP_PASSWORD. */
export function checkPassword(input: unknown): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD is not set");
  if (typeof input !== "string") return false;
  return safeEqual(input, expected);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
