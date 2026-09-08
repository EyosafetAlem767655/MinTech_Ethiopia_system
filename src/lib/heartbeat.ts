import sql from "@/lib/sql";
import { logError } from "@/lib/errors";
import { chaseHolder, eatToday, type WhtHolder } from "@/lib/wht-sms";

/**
 * The daily work, without a scheduler.
 *
 * Vercel's cron refused the schedule this needed, so nothing here depends on one
 * any more. Instead the ordinary traffic the system already gets — a Telegram
 * update, someone opening the dashboard — carries the day's work with it: the
 * request is answered first, and this runs behind it via `runAfter`.
 *
 * That is only safe because "once a day" is enforced by the DATA, not by the
 * caller. `wht_sms_log` has a unique (holder_id, sent_on), and `chaseHolder`
 * claims that row before it sends. So this function can be called a thousand
 * times a day from a hundred instances and a customer still receives exactly one
 * message. The in-memory day marker below is a cost saving, never the guarantee
 * — an instance that has never seen today simply does the check again and finds
 * the day already claimed.
 *
 * Nothing here throws. It runs behind a response that has already been sent, so
 * a failure has nobody to report to except the error log.
 */

/**
 * The last EAT day this instance did the rounds.
 *
 * Serverless instances are short-lived and there are many of them, so this
 * catches the common case (a burst of updates in one conversation) and nothing
 * more. Correctness never rests on it.
 */
let lastSweptDay = "";

export interface HeartbeatResult {
  ran: boolean;
  chased: number;
  alreadyChased: number;
  failed: number;
}

const IDLE: HeartbeatResult = { ran: false, chased: 0, alreadyChased: 0, failed: 0 };

/**
 * Chase every outstanding WHT receipt whose day has not been claimed.
 *
 * `force` skips the in-memory marker — used by the cron route, which should do
 * the work whether or not that particular instance happens to have done it.
 */
export async function dailyHeartbeat(force = false): Promise<HeartbeatResult> {
  const today = eatToday();
  if (!force && lastSweptDay === today) return IDLE;
  lastSweptDay = today;

  const result: HeartbeatResult = { ran: true, chased: 0, alreadyChased: 0, failed: 0 };

  try {
    const holders = await sql<WhtHolder[]>`
      select id, company, phone, description from wht_holders where status = 'pending'
    `.catch(() => []);

    for (const h of holders) {
      const res = await chaseHolder(h);
      if (!res.claimed) result.alreadyChased += 1;
      else if (res.ok) result.chased += 1;
      else result.failed += 1;
    }
  } catch (e) {
    await logError({
      source: "heartbeat",
      kind: "heartbeat_chase_failed",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return result;
}

/** Reset the day marker. Tests only — production instances are short-lived. */
export function resetHeartbeatMemo(): void {
  lastSweptDay = "";
}
