import sql from "@/lib/sql";
import { eatDateLabel } from "@/lib/dates";

/**
 * Daily ceiling on dashboard AI chat.
 *
 * The dashboard authenticates with one shared ADMIN_PASSWORD, so there is no
 * per-person identity to meter — the closest thing is the per-device web session
 * id minted at login. Each signed-in device therefore gets its own allowance,
 * which is what "per user" means under this auth model.
 *
 * The day is an EAT calendar date, so the reset needs no cron: a new day simply
 * has no row yet.
 */
export const CHAT_DAILY_LIMIT = Number(process.env.CHAT_DAILY_LIMIT) || 10;

export interface QuotaVerdict {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  /** ISO instant when the allowance resets (next EAT midnight). */
  resetsAt: string;
}

/** Next EAT midnight, as an instant. */
function nextEatMidnight(now = new Date()): Date {
  // Add 24h to this EAT day's midnight rather than incrementing the day number —
  // "31 + 1" would produce 2026-08-32 and an Invalid Date at every month end.
  const midnight = new Date(`${eatDateLabel(now)}T00:00:00+03:00`);
  return new Date(midnight.getTime() + 86_400_000);
}

/**
 * Claim one request against today's allowance.
 *
 * The increment happens BEFORE the model call and in the same statement that
 * reads the count, so two concurrent questions cannot both see "9 used" and both
 * proceed. A request that later fails still consumes its slot — the alternative
 * is refunding on error, which turns any reliably-failing prompt into an
 * unmetered retry loop.
 */
export async function claimChatRequest(actor: string): Promise<QuotaVerdict> {
  const day = eatDateLabel(new Date());
  const resetsAt = nextEatMidnight().toISOString();

  try {
    const [row] = await sql<{ used: number }[]>`
      insert into ai_chat_usage (actor, day, used)
      values (${actor}, ${day}, 1)
      on conflict (actor, day) do update
        set used = ai_chat_usage.used + 1, updated_at = now()
      returning used
    `;
    const used = Number(row?.used) || 1;
    return {
      allowed: used <= CHAT_DAILY_LIMIT,
      limit: CHAT_DAILY_LIMIT,
      used,
      remaining: Math.max(0, CHAT_DAILY_LIMIT - used),
      resetsAt,
    };
  } catch (e) {
    // Table not created yet (42P01) — fail OPEN. A missing migration should not
    // take the assistant offline; the cap is a cost guard, not a security control.
    if ((e as { code?: string })?.code === "42P01") {
      console.warn("ai_chat_usage missing — chat quota not enforced. Apply migration 0013.");
      return { allowed: true, limit: CHAT_DAILY_LIMIT, used: 0, remaining: CHAT_DAILY_LIMIT, resetsAt };
    }
    throw e;
  }
}

/** Read today's usage without consuming a slot (for showing "N left"). */
export async function peekChatQuota(actor: string): Promise<QuotaVerdict> {
  const day = eatDateLabel(new Date());
  const resetsAt = nextEatMidnight().toISOString();
  try {
    const [row] = await sql<{ used: number }[]>`
      select used from ai_chat_usage where actor = ${actor} and day = ${day}
    `;
    const used = Number(row?.used) || 0;
    return {
      allowed: used < CHAT_DAILY_LIMIT,
      limit: CHAT_DAILY_LIMIT,
      used,
      remaining: Math.max(0, CHAT_DAILY_LIMIT - used),
      resetsAt,
    };
  } catch {
    return { allowed: true, limit: CHAT_DAILY_LIMIT, used: 0, remaining: CHAT_DAILY_LIMIT, resetsAt };
  }
}
