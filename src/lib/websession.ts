/**
 * Web (dashboard) session store — Edge-safe half. The mt_auth cookie holds an
 * opaque random token that maps to a `web_sessions` row. The Edge middleware
 * imports this file to validate a token, so it must stay dependency-light and
 * must NOT pull in postgres.js (which can't run on Edge).
 *
 * Validation goes straight to Supabase's PostgREST endpoint with a plain,
 * timeout-bounded `fetch` (NOT @supabase/supabase-js — that client can hang
 * inside Edge middleware, which stalls every dashboard request). The service
 * ("secret") key bypasses RLS. Table creation and all other writes live in
 * websession-node.ts (postgres.js, Node runtime only).
 */

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Friendly "Chrome · Windows" style label from a user-agent string. */
export function deviceLabel(userAgent?: string | null): string {
  const ua = userAgent || "";
  const browser = /edg/i.test(ua)
    ? "Edge"
    : /chrome|crios/i.test(ua)
    ? "Chrome"
    : /firefox|fxios/i.test(ua)
    ? "Firefox"
    : /safari/i.test(ua)
    ? "Safari"
    : "Browser";
  const os = /windows/i.test(ua)
    ? "Windows"
    : /android/i.test(ua)
    ? "Android"
    : /iphone|ipad|ipod/i.test(ua)
    ? "iOS"
    : /mac os/i.test(ua)
    ? "macOS"
    : /linux/i.test(ua)
    ? "Linux"
    : "Unknown OS";
  return `${browser} · ${os}`;
}

export interface WebSessionRow {
  id: string;
  label: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

/**
 * Middleware authorization check (Edge): has THIS device's session been revoked?
 *
 * Authentication already happened (the cookie signature was verified with zero
 * network in auth.ts). This only enforces per-device revocation, and it FAILS
 * OPEN: it returns true (revoked → block) only when it positively reads a row
 * whose revoked_at is set. A timeout, network error, RLS block, or missing row
 * all return false (allow), so a slow or misconfigured database can never lock a
 * validly-signed-in user out of the dashboard.
 *
 * The same PATCH also refreshes last_seen_at, so "last active" updates in one
 * round-trip. Bounded by a 3s AbortController.
 */
export async function isSessionRevoked(sid: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !sid) return false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${url}/rest/v1/web_sessions?id=eq.${encodeURIComponent(sid)}&select=revoked_at`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as { revoked_at: string | null }[];
    return Array.isArray(rows) && rows.length > 0 && rows[0].revoked_at != null;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
