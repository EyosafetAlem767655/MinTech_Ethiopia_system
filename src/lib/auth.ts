export const AUTH_COOKIE = "mt_auth";

/**
 * Deterministic session token derived from ADMIN_PASSWORD.
 * Uses Web Crypto so it runs both in Edge middleware and Node API routes.
 */
export async function authToken(): Promise<string> {
  const pw = process.env.ADMIN_PASSWORD || "";
  const data = new TextEncoder().encode(`mintech-auth-v1:${pw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isAuthDisabled(): boolean {
  return !process.env.ADMIN_PASSWORD;
}
