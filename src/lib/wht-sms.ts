import sql from "@/lib/sql";
import { logError } from "@/lib/errors";
import { sendSms, smsGatewayConfigured, type SmsResult } from "@/lib/sms";

/**
 * Chasing a customer for the 3% withholding receipt.
 *
 * One function, three callers — the dashboard registration, the bot flow and the
 * daily cron — because the "once a day per holder" rule only holds if every path
 * claims the day the same way. Registration now texts immediately, so without a
 * shared claim the cron would text the same customer again the next morning
 * hours after they had already been asked.
 *
 * The claim comes BEFORE the send, deliberately. The unique (holder_id, sent_on)
 * index is what makes "one a day" true: a retry, an overlapping invocation or a
 * double cron fire all lose the race here instead of texting a customer twice.
 * And the claim row is UPDATED rather than deleted when the send fails — deleting
 * it would let the next run try again the same day, which is how a broken gateway
 * turns into a flood of duplicate messages.
 */

export interface WhtHolder {
  id: string;
  company: string;
  phone: string;
  description?: string | null;
}

export type ChaseResult = SmsResult & { claimed: boolean };

/** EAT calendar day — the day the once-per-holder guard is keyed on. */
export function eatToday(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

export function chaseMessage(h: WhtHolder): string {
  return (
    `MinTech Ethiopia: we are still missing the 3% withholding (WHT) receipt from ` +
    `${h.company}${h.description ? ` for ${h.description}` : ""}. ` +
    `Please send it at your earliest convenience. Thank you.`
  );
}

/**
 * Send today's chase for one holder, if today has not been used yet.
 *
 * `claimed: false` means someone already asked them today — a normal outcome,
 * not a failure.
 */
export async function chaseHolder(h: WhtHolder, now = new Date()): Promise<ChaseResult> {
  const today = eatToday(now);

  // Nothing can send, so nothing claims the day. Claiming first and failing
  // would mark this customer as chased and skip them until tomorrow — an unset
  // API key would quietly cost a day of chasing for every holder, every day.
  if (!smsGatewayConfigured()) {
    return { ok: false, skipped: true, claimed: false, error: "the SMS gateway is not configured" };
  }

  const claimed = await sql<{ id: string }[]>`
    insert into wht_sms_log (holder_id, sent_on, phone)
    values (${h.id}, ${today}::date, ${h.phone})
    on conflict (holder_id, sent_on) do nothing
    returning id
  `.catch(async (e) => {
    await logError({
      source: "wht-sms",
      kind: "wht_sms_claim_failed",
      message: e instanceof Error ? e.message : String(e),
      detail: { holderId: h.id },
    });
    return [];
  });

  if (claimed.length === 0) {
    return { ok: false, skipped: true, claimed: false, error: "already chased today" };
  }

  const res = await sendSms(h.phone, chaseMessage(h));

  await sql`
    update wht_sms_log
       set ok = ${res.ok}, status = ${res.status ?? null}, error = ${res.error ?? null},
           route = ${res.route ?? null}
     where holder_id = ${h.id} and sent_on = ${today}::date
  `.catch(async () => {
    // `route` arrives in 0020. Losing which gateway delivered is a nuisance;
    // losing the record that we sent at all would let tomorrow's run text the
    // customer twice, so the rest of the update still has to land.
    await sql`
      update wht_sms_log
         set ok = ${res.ok}, status = ${res.status ?? null}, error = ${res.error ?? null}
       where holder_id = ${h.id} and sent_on = ${today}::date
    `.catch(() => {});
  });

  if (!res.ok && !res.skipped) {
    await logError({
      source: "wht-sms",
      kind: "wht_sms_failed",
      message: res.error || `HTTP ${res.status ?? "?"}`,
      detail: { holderId: h.id, company: h.company, status: res.status ?? null },
    });
  }

  return { ...res, claimed: true };
}
