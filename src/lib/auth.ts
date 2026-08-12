export const AUTH_COOKIE = "mt_auth";

/**
 * Deterministic session token derived from ADMIN_PASSWORD.
 * Uses Web Crypto so it runs both in Edge middleware and Node API routes.
 */
export async function authToken(): Promise<string> {
  const pw = process.env.ADMIN_PASSWORD || "";
  // Bump the version tag to force every existing cookie to re-authenticate. v2
  // invalidates the untracked v1 fallback cookies so all devices sign in again
  // and get recorded in web_sessions (Settings ▸ Devices).
  const data = new TextEncoder().encode(`mintech-auth-v2:${pw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isAuthDisabled(): boolean {
  return !process.env.ADMIN_PASSWORD;
}
