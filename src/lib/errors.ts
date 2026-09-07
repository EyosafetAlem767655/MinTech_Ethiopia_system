import sql, { jsonb } from "@/lib/sql";

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
    return { logged: true, shouldAlert };
  } catch (e) {
    // The table arrives in 0021, and the database can be down precisely when
    // things are failing. Neither is a reason to throw out of a catch block.
    console.error("logError could not record the error:", e);
    return { logged: false, shouldAlert: false };
  }
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
 * Separate from `logError` on purpose: logging happens on paths that must not
 * make network calls (inside the webhook's reply path, inside catch blocks), and
 * alerting is a Telegram round trip. The caller decides when it is safe.
 */
export async function alertAdmins(rec: ErrorRecord & { shouldAlert: boolean }): Promise<void> {
  if (!rec.shouldAlert) return;
  try {
    const { sendMessage } = await import("@/lib/telegram");
    const admins = await sql<{ chat_id: string }[]>`
      select chat_id from telegram_users
       where active = true and chat_id is not null and 'admin' = any(positions)
    `;
    const text =
      `🚨 <b>የስርዓት ችግር</b>\n` +
      `<code>${rec.kind}</code> · ${rec.source}\n\n` +
      `${String(rec.message).slice(0, 300)}\n\n` +
      `<i>ተመሳሳይ ችግር በሰዓት አንዴ ብቻ ይላካል። ዝርዝሩ በ Settings → Errors ላይ አለ።</i>`;
    await Promise.all(admins.map((a) => sendMessage(String(a.chat_id), text).catch(() => {})));
  } catch (e) {
    console.error("alertAdmins failed:", e);
  }
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
