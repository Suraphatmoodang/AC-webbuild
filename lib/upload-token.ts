import crypto from "crypto";

// ── Upload token (SERVER ONLY — never import from a page/component) ──────────
//
// The rest of the app's "auth" is a sessionStorage flag, which is fine for hiding
// buttons but useless to an API route: anyone can POST to /api/images/sign. That
// endpoint hands out WRITE access to the R2 bucket, so it needs something the server
// can actually check — hence this short signed token.
//
// It is issued by /api/auth/login on a successful password check, kept in
// sessionStorage next to the role, and sent back on every sign/delete request.
// Payload is not secret (it's base64, not encrypted) — the signature is the point:
// the server can tell it minted this token and that it hasn't expired or been edited.
//
// This does NOT turn the app into a real security boundary (see lib/auth.ts). It
// only closes the one hole that costs money: a stranger filling the bucket.
//
// Requires env var UPLOAD_TOKEN_SECRET (any long random string — e.g.
// `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
// With it unset, minting and verification both fail CLOSED: uploads are refused
// with a clear message rather than silently accepting everyone.

export type UploadClaims = { role: string; exp: number };

// A login is good for a work session; after this the user re-logs in to upload.
const TTL_MS = 12 * 60 * 60 * 1000;

const secret = (): string | null => process.env.UPLOAD_TOKEN_SECRET?.trim() || null;

const b64url = (b: Buffer): string => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

const sign = (data: string, key: string): string =>
  b64url(crypto.createHmac("sha256", key).update(data).digest());

export function mintUploadToken(role: string, now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const body = b64url(Buffer.from(JSON.stringify({ role, exp: now + TTL_MS })));
  return `${body}.${sign(body, key)}`;
}

// Returns the claims, or null for anything not currently valid — bad shape, wrong
// signature, expired. Callers treat null as "refuse".
export function verifyUploadToken(token: unknown, now = Date.now()): UploadClaims | null {
  const key = secret();
  if (!key || typeof token !== "string") return null;

  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = token.slice(dot + 1);

  // Constant-time compare so the signature can't be guessed byte-by-byte by timing.
  const expected = sign(body, key);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(unb64url(body).toString("utf8")) as UploadClaims;
    if (typeof claims?.exp !== "number" || claims.exp < now) return null;
    if (typeof claims?.role !== "string" || !claims.role) return null;
    return claims;
  } catch {
    return null;
  }
}

export const uploadTokenConfigured = (): boolean => secret() !== null;
