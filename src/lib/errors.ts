import sql, { jsonb } from "@/lib/sql";
import { runAfter } from "@/lib/after";
import { notifyAdmins } from "@/lib/admins";

/**
 * The one place a failure gets recorded.
 *
 * Before this existed, a Gemini timeout reached exactly one human — the
 * salesperson holding the phone — and left no trace anywhere else. Nobody could
 * answer "how often does this happen", "is it happening right now", or "did the
 * receipts behind it survive".
 *
 * The rule that shapes this whole module: **logError never throws and never
 * rejects.** It is called from catch blocks and from fire-and-forget paths, so a
 * logger that could fail would turn one handled failure into an unhandled one —
 * strictly worse than having no logger at all. Every failure inside it,
 * including the database being down, ends at console.error.
 */

export interface ErrorRecord {
  /** Module or route: "llm", "telegram-webhook", "cron/finance-daily". */
  source: string;
  /**
   * A STABLE slug — "gemini_timeout", "gemini_http_404", "sales_scan_failed".
   *
   * Never interpolate a varying detail (an id, a duration, a chat) into this.
   * Alerts are rate-limited per kind, and a kind that is unique every time
   * defeats the rate limit and floods the administrators, which is how an alert
   * channel becomes one nobody reads.
   */
  kind: string;
  message: string;
  detail?: Record<string, unknown>;
  actor?: string | null;
  chatId?: string | null;
}

/** How long one `kind` stays quiet after an alert has gone out. */
const ALERT_COOLDOWN_MINUTES = 60;

/**
 * Kinds that are recorded but never pushed to a phone.
 *
 * These are the Gemini layer reporting that it HANDLED something — switched
 * model, waited out a busy one, fell back to another provider, succeeded on a
 * retry. Every Gemini outage produces dozens of them, and pushing each one
 * would bury the failure that actually needs a person under a pile of
 * successes. They are counted in the morning summary instead.
 */
export const INFO_KINDS: ReadonlySet<string> = new Set([
  "gemini_retry_succeeded",
  "gemini_model_migrated",
  "gemini_busy_fallback",
  "gemini_text_fallback",
]);

/**
 * Record a failure. Returns whether this is the first of its kind this hour,
 * which is what the caller uses to decide whether to alert a human.
 *
 * Returns false on any internal failure, so a broken logger can never cause an
 * alert storm either.
 */
export async function logError(rec: ErrorRecord): Promise<{ logged: boolean; shouldAlert: boolean }> {
  // Always visible in the platform logs, whatever happens to the table below.
  console.error(`[${rec.source}] ${rec.kind}: ${rec.message}`, rec.detail ?? "");

  try {
    const since = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60_000);
    // Asked BEFORE the insert, or the row just written would answer its own
    // question and no alert would ever fire.
    const recent = await sql<{ n: string }[]>`
      select count(*) as n from system_errors
       where kind = ${rec.kind} and created_at >= ${since}
    `;
    const shouldAlert = Number(recent[0]?.n ?? 0) === 0;

    await sql`
      insert into system_errors (source, kind, message, detail, actor, chat_id)
      values (${rec.source}, ${rec.kind}, ${String(rec.message).slice(0, 2000)},
              ${rec.detail ? jsonb(rec.detail) : null},
              ${rec.actor ?? null}, ${rec.chatId ?? null})
    `;

    // The administrators hear about it — after the response, never inside it.
    // Nothing called alertAdmins for months, so every error in this table was
    // one nobody was told about. runAfter keeps the Telegram round trip off the
    // caller's path, which is why the two were kept apart in the first place.
    if (shouldAlert && !INFO_KINDS.has(rec.kind)) {
      runAfter(alertAdmins({ ...rec, shouldAlert }));
    }
    return { logged: true, shouldAlert };
  } catch (e) {
    // The table arrives in 0021, and the database can be down precisely when
    // things are failing. Neither is a reason to throw out of a catch block.
    console.error("logError could not record the error:", e);
    if (WRITE_REFUSED.has((e as { code?: string })?.code ?? "")) runAfter(alertWritesRefused(rec));
    return { logged: false, shouldAlert: false };
  }
}

/**
 * The database answering reads but refusing writes: read-only (25006, what
 * Supabase does to a project that outgrows its plan's disk) or out of space
 * (53100). This is the one way the size limit can stop the system, and it is
 * Supabase's doing, not this application's — so the least this can do is make
 * sure someone hears it. The error table cannot take the row, which is how this
 * is noticed, so the hourly limit is kept in memory instead (per instance:
 * good enough to stop a flood, at worst a few duplicates).
 */
const WRITE_REFUSED: ReadonlySet<string> = new Set(["25006", "53100"]);
let lastWritesRefusedAlert = 0;

async function alertWritesRefused(rec: ErrorRecord): Promise<void> {
  if (Date.now() - lastWritesRefusedAlert < ALERT_COOLDOWN_MINUTES * 60_000) return;
  lastWritesRefusedAlert = Date.now();
  await notifyAdmins(
    `🔴 <b>የመረጃ ቋቱ መረጃ መቀበል አቁሟል</b>\n` +
      `Supabase is refusing writes (read-only or out of space). New reports and sales cannot be saved until this is fixed.\n\n` +
      `Last failure: <code>${escapeHtml(rec.kind)}</code> · ${escapeHtml(rec.source)}\n\n` +
      `Fix: free space (archive move, or raise the plan in Supabase), or fail over to Neon — docs/RUNBOOK-failover.md.`
  );
}

/**
 * Classify a provider failure into a stable kind.
 *
 * Kept here rather than at the call sites so the same failure is always filed
 * under the same slug — the rate limit and every "how often" question depend on
 * that consistency.
 */
export function providerErrorKind(provider: string, message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("timed out") || m.includes("timeout") || m.includes("abort")) return `${provider}_timeout`;
  const status = m.match(/http (\d{3})/)?.[1];
  if (status) return `${provider}_http_${status}`;
  if (m.includes("not set") || m.includes("api key")) return `${provider}_not_configured`;
  if (m.includes("unreadable") || m.includes("empty response")) return `${provider}_unreadable`;
  return `${provider}_failed`;
}

/**
 * Tell the administrators, at most once an hour per kind.
 *
 * Separate from `logError` because alerting is a Telegram round trip, and the
 * paths that log must not make one inline. `logError` schedules this with
 * runAfter, so it happens after the response has gone.
 */
export async function alertAdmins(rec: ErrorRecord & { shouldAlert: boolean }): Promise<void> {
  if (!rec.shouldAlert) return;
  const text =
    `🚨 <b>የስርዓት ችግር</b>\n` +
    `<code>${escapeHtml(rec.kind)}</code> · ${escapeHtml(rec.source)}\n\n` +
    `${escapeHtml(String(rec.message).slice(0, 300))}\n\n` +
    `<i>ተመሳሳይ ችግር በሰዓት አንዴ ብቻ ይላካል። ዝርዝሩ በ 🛠 System Admin እና Settings → Errors ላይ አለ።</i>`;
  await notifyAdmins(text);
}

/** Telegram's HTML mode rejects a whole message over one stray "<" in an error text. */
export function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Mark open errors as seen. With `kinds`, only those; without, every open one.
 * Returns how many were resolved. The rows are kept — see the errors route for
 * why resolving hides rather than deletes.
 */
export async function resolveErrors(by: string, kinds?: string[]): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    update system_errors set resolved_at = now(), resolved_by = ${by}
     where resolved_at is null
       and ${kinds && kinds.length ? sql`kind = any(${kinds})` : sql`true`}
     returning id
  `;
  return rows.length;
}

export interface OpenError {
  id: string;
  source: string;
  kind: string;
  message: string;
  detail: Record<string, unknown> | null;
  actor: string | null;
  chatId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  /** How many of this kind in the last 24 hours — a one-off reads differently. */
  last24h: number;
}

/** The error list behind the Settings tab, newest first. */
export async function listErrors(opts: { limit?: number; includeResolved?: boolean } = {}): Promise<OpenError[]> {
  const limit = Math.min(opts.limit ?? 100, 300);
  const rows = await sql<Record<string, unknown>[]>`
    select e.id, e.source, e.kind, e.message, e.detail, e.actor,
           e.chat_id as "chatId", e.created_at as "createdAt", e.resolved_at as "resolvedAt",
           (select count(*) from system_errors s
             where s.kind = e.kind and s.created_at >= now() - interval '24 hours') as "last24h"
      from system_errors e
     where ${opts.includeResolved ? sql`true` : sql`e.resolved_at is null`}
     order by e.created_at desc
     limit ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    source: String(r.source),
    kind: String(r.kind),
    message: String(r.message),
    detail: (r.detail as Record<string, unknown>) ?? null,
    actor: (r.actor as string) ?? null,
    chatId: (r.chatId as string) ?? null,
    createdAt: String(r.createdAt),
    resolvedAt: (r.resolvedAt as string) ?? null,
    last24h: Number(r.last24h) || 0,
  }));
}
