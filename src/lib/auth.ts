export const AUTH_COOKIE = "mt_auth";

/**
 * Dashboard auth is a signed cookie, verified with ZERO network calls.
 *
 * The cookie is `<sid>.<hmac>` where sid is the web_sessions row id (a per-device
 * handle) and hmac = HMAC-SHA256(sid, ADMIN_PASSWORD). The Edge middleware
 * verifies the signature with Web Crypto alone — no database read — so a valid
 * ADMIN_PASSWORD login is ALWAYS accepted and the dashboard can never hang or
 * loop on a slow/misconfigured database. Device listing and revocation are
 * layered on top separately and fail open, so they can't lock anyone out.
 *
 * Bump SIGN_VERSION to invalidate every existing cookie (forces a re-login).
 */
const SIGN_VERSION = "v3";

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function hmacHex(sid: string): Promise<string> {
  const secret = process.env.ADMIN_PASSWORD || "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`mintech-auth-${SIGN_VERSION}:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sid));
  return toHex(sig);
}

/** Builds the signed cookie value for a session id. */
export async function signSession(sid: string): Promise<string> {
  return `${sid}.${await hmacHex(sid)}`;
}

/** Returns the session id if the cookie's signature is valid, else null. */
export async function verifySession(cookie: string | undefined | null): Promise<string | null> {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const sid = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = await hmacHex(sid);
  // Length-then-content compare; the values are HMACs of the same length.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? sid : null;
}

export function isAuthDisabled(): boolean {
  return !process.env.ADMIN_PASSWORD;
}
