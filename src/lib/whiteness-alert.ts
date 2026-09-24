import sql from "@/lib/sql";
import { sendMessage } from "@/lib/telegram";
import { hasPosition } from "@/lib/positions";
import { productLabel } from "@/lib/products";
import { bandLabel, belowSpec, specFor } from "@/lib/whiteness-spec";

/**
 * Tell the admins and HR when a whiteness check comes in under spec.
 *
 * The reading itself has always been recorded and shown; what was missing was
 * anybody being told. A batch below its band is only worth knowing about while
 * it is still on the line, and the people who can stop it are not the people
 * refreshing a dashboard.
 *
 * Two rules govern this file:
 *
 *  - It NEVER blocks the reporter. It is called from the webhook behind
 *    `runAfter`, after the ✅ has already gone out. Slow work in that handler is
 *    what makes Telegram redeliver the update forever.
 *  - It alerts ONCE per check. A check is upserted on
 *    (date_label, quarter, product_code, line), so filing the round again or
 *    correcting one slot rewrites the row — and without the claim below, every
 *    one of those rewrites would page everybody about the same reading.
 */

interface CheckRow {
  id: string;
  date_label: string;
  quarter: number;
  product_code: string;
  line: number;
  readings: Record<string, string> | null;
  reported_by: string;
}

interface Recipient {
  full_name: string;
  positions: string[];
  chat_id: string;
}

/**
 * Take ownership of the alarm for this check.
 *
 * `where alerted_at is null` is the whole mechanism: two invocations racing —
 * a Telegram redelivery against the original, say — both run this statement and
 * exactly one of them gets a row back. The other sends nothing.
 *
 * Returns true when the column is missing (0032 not yet run) so the alarm still
 * goes out: being told twice about a bad batch is a far smaller failure than
 * not being told at all, and Settings → Errors names the migration.
 */
async function claimAlert(id: string): Promise<boolean> {
  try {
    const rows = await sql<{ id: string }[]>`
      update whiteness_checks set alerted_at = now()
       where id = ${id}::uuid and alerted_at is null
       returning id
    `;
    return rows.length > 0;
  } catch (e) {
    if ((e as { code?: string })?.code === "42703") {
      console.warn("whitenessAlert: whiteness_checks.alerted_at is missing — run 0032; alerting without dedupe");
      return true;
    }
    throw e;
  }
}

/** Everyone who should hear about it: the admins and HR, with a known chat. */
async function recipients(): Promise<Recipient[]> {
  const rows = await sql<Recipient[]>`
    select full_name, positions, chat_id
      from telegram_users
     where active = true and chat_id is not null
  `;
  return rows.filter((u) => hasPosition(u.positions, "admin") || hasPosition(u.positions, "hr"));
}

/** The message, in the language the bot speaks. */
export function alertText(row: CheckRow, breaches: { slot: string; value: number }[]): string {
  const spec = specFor(row.product_code);
  const failing = breaches.map((b) => `${b.slot.toUpperCase()} ${b.value}%`).join("፣ ");
  return (
    `⚠️ <b>የነጭነት ጥራት ማስጠንቀቂያ</b>\n\n` +
    `📦 ምርት: <b>${productLabel(row.product_code)}</b>${spec ? ` (${spec.fineness})` : ""}\n` +
    `🏭 መስመር: ${row.line} · ${row.quarter}ኛ ዙር · ${row.date_label}\n` +
    `📉 ከመስፈርት በታች: <b>${failing}</b>\n` +
    (spec ? `✅ መስፈርት: ${bandLabel(spec)} — ${spec.grade}\n` : "") +
    `🙍 ሪፖርት አድራጊ: ${row.reported_by}\n\n` +
    `<i>ምርቱ በመስመር ላይ እያለ ይጣራ።</i>`
  );
}

/**
 * Check one saved whiteness row and alert if it is under spec.
 *
 * Returns what it did, for the caller and for tests. Never throws: a quality
 * alarm that fails must not turn a saved report into a failed one, and the
 * reading is on the dashboard either way.
 */
export async function whitenessAlert(checkId: string): Promise<{ breaches: number; sent: number }> {
  try {
    const [row] = await sql<CheckRow[]>`
      select id, date_label, quarter, product_code, line, readings, reported_by
        from whiteness_checks where id = ${checkId}::uuid
    `;
    if (!row) return { breaches: 0, sent: 0 };

    const breaches = belowSpec(row.product_code, row.readings);
    // No band for this product, or everything inside it: nothing to say. The
    // row is deliberately NOT claimed, so a later correction that does breach
    // the band still alerts.
    if (breaches.length === 0) return { breaches: 0, sent: 0 };

    if (!(await claimAlert(row.id))) return { breaches: breaches.length, sent: 0 };

    const text = alertText(row, breaches);
    const people = await recipients();
    let sent = 0;
    await Promise.all(
      people.map(async (u) => {
        // One unreachable chat — blocked bot, deleted account — must not cost
        // the others their warning.
        try {
          await sendMessage(String(u.chat_id), text);
          sent++;
        } catch (e) {
          console.warn(`whitenessAlert: could not reach ${u.full_name}`, e);
        }
      })
    );
    return { breaches: breaches.length, sent };
  } catch (e) {
    console.error("whitenessAlert failed", e);
    return { breaches: 0, sent: 0 };
  }
}
