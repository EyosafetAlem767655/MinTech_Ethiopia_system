import { isRole, type Role } from "@/lib/roles";

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

/**
 * Builds the signed cookie value for a session id and the role it was opened
 * with: `<sid>.<role>.<hmac(sid|role)>`. The role is inside the signature, so
 * it cannot be edited in the browser to climb from HR to Super Admin.
 */
export async function signSession(sid: string, role: Role = "super"): Promise<string> {
  return `${sid}.${role}.${await hmacHex(`${sid}|${role}`)}`;
}

const sameHex = (a: string, b: string) => {
  // Length-then-content compare; the values are HMACs of the same length.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/**
 * The session id and role, if the cookie's signature is valid, else null.
 *
 * A cookie from before roles (`<sid>.<hmac(sid)>`) could only have been minted
 * by the ADMIN_PASSWORD login, so it reads as the Super Admin.
 */
export async function readSession(cookie: string | undefined | null): Promise<{ sid: string; role: Role } | null> {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length === 3) {
    const [sid, role, sig] = parts;
    if (!sid || !isRole(role)) return null;
    return sameHex(sig, await hmacHex(`${sid}|${role}`)) ? { sid, role } : null;
  }
  if (parts.length === 2) {
    const [sid, sig] = parts;
    if (!sid) return null;
    return sameHex(sig, await hmacHex(sid)) ? { sid, role: "super" } : null;
  }
  return null;
}

/** Returns the session id if the cookie's signature is valid, else null. */
export async function verifySession(cookie: string | undefined | null): Promise<string | null> {
  return (await readSession(cookie))?.sid ?? null;
}

export function isAuthDisabled(): boolean {
  return !process.env.ADMIN_PASSWORD;
}
