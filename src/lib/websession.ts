import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Web (dashboard) session store. The mt_auth cookie holds an opaque random token
 * that maps to a `web_sessions` row. Used by the Edge middleware (validation) and
 * the login/logout/device routes (create/list/revoke). Reads/writes go through
 * the Supabase service ("secret") key, which bypasses RLS and — being fetch-based
 * — works inside Edge middleware where the postgres.js client cannot run.
 */

let _admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  if (!_admin) _admin = createClient(url, key, { auth: { persistSession: false } });
  return _admin;
}

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

/** Middleware gate (Edge): true when the token is an active, non-revoked session. */
export async function isValidSession(token: string): Promise<boolean> {
  const db = supabaseAdmin();
  if (!db) return false;
  const { data, error } = await db
    .from("web_sessions")
    .select("id")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return false;
  // Best-effort last-seen refresh; never block the request on it.
  void db.from("web_sessions").update({ last_seen_at: new Date().toISOString() }).eq("token", token);
  return true;
}

export async function createSession(input: { token: string; label: string; userAgent: string; ip: string }): Promise<void> {
  const db = supabaseAdmin();
  if (!db) throw new Error("Session store not configured (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY).");
  const { error } = await db.from("web_sessions").insert({
    token: input.token,
    label: input.label,
    user_agent: input.userAgent,
    ip: input.ip,
  });
  if (error) throw new Error(error.message);
}

export async function listSessions(): Promise<WebSessionRow[]> {
  const db = supabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("web_sessions")
    .select("id,label,user_agent,ip,created_at,last_seen_at,revoked_at")
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });
  return (data || []) as WebSessionRow[];
}

export async function revokeSession(id: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db) return;
  await db.from("web_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", id);
}

export async function revokeByToken(token: string): Promise<void> {
  const db = supabaseAdmin();
  if (!db) return;
  await db.from("web_sessions").update({ revoked_at: new Date().toISOString() }).eq("token", token);
}

export async function sessionIdForToken(token: string): Promise<string | null> {
  const db = supabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("web_sessions").select("id").eq("token", token).maybeSingle();
  return data?.id ?? null;
}
