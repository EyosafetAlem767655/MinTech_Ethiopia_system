import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { logActivity } from "@/lib/bot-auth";
import { hasPosition, resolveCapabilities } from "@/lib/positions";
import { sendSms, smsGatewayConfigured } from "@/lib/sms";
import { sendMessage } from "@/lib/telegram";
import { describeGap, reconcileBags } from "@/lib/stock-reconciliation";
import {
  eatDayOfMonth,
  isBaseBalanceReminderWindow,
  monthLabel,
  nextMonth,
} from "@/lib/finance-report";

/** How many days into a month HR and Admin keep hearing that it opened unfiled. */
const ESCALATION_DAYS = 3;

/** Days remaining in the current EAT month, 0 on the last day. */
function daysLeftInMonth(now: Date): number {
  const eat = new Date(now.getTime() + 3 * 3600_000);
  const daysInMonth = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() + 1, 0)).getUTCDate();
  return daysInMonth - eat.getUTCDate();
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The finance department's daily job. Two things, one cron entry.
 *
 *  1. Chase every outstanding WHT receipt by SMS — exactly one message per
 *     holder per day.
 *  2. Three days before the month ends, ask asset management for next month's
 *     opening balance; and once the month has opened without one, escalate.
 *
 * They share an entry because they share a schedule and neither is heavy. A
 * second `vercel.json` cron would buy nothing but another thing to forget.
 */

interface Emp {
  id: string;
  full_name: string;
  positions: string[];
  capabilities: string[] | null;
  chat_id: string;
  logged_in: boolean;
}

/** EAT calendar day, which is the day the once-per-holder guard is keyed on. */
function eatToday(now: Date): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const today = eatToday(now);

  const employees = await sql<Emp[]>`
    select id, full_name, positions, capabilities, chat_id, logged_in
      from telegram_users
     where active = true and chat_id is not null
  `;

  /* ─────────────────── 1. Chase the outstanding WHT receipts ─────────────── */

  const holders = await sql<{ id: string; company: string; phone: string; description: string | null }[]>`
    select id, company, phone, description from wht_holders where status = 'pending'
  `.catch(() => []);

  let smsSent = 0;
  let smsFailed = 0;
  let smsSkipped = 0;

  for (const h of holders) {
    // Claim the day BEFORE sending. The unique (holder_id, sent_on) index is
    // what makes "one a day" true: a retry, an overlapping invocation or a
    // double cron fire all lose the race here instead of sending twice.
    const claimed = await sql<{ id: string }[]>`
      insert into wht_sms_log (holder_id, sent_on, phone)
      values (${h.id}, ${today}::date, ${h.phone})
      on conflict (holder_id, sent_on) do nothing
      returning id
    `.catch(() => []);
    if (claimed.length === 0) {
      smsSkipped += 1;
      continue;
    }

    const message =
      `MinTech Ethiopia: we are still missing the 3% withholding (WHT) receipt from ` +
      `${h.company}${h.description ? ` for ${h.description}` : ""}. ` +
      `Please send it at your earliest convenience. Thank you.`;

    const res = await sendSms(h.phone, message);
    // The claim row is UPDATED rather than deleted on failure. Deleting it would
    // let the next run try again the same day, which is how a broken gateway
    // turns into a flood of duplicate messages to a customer.
    await sql`
      update wht_sms_log
         set ok = ${res.ok}, status = ${res.status ?? null}, error = ${res.error ?? null}
       where holder_id = ${h.id} and sent_on = ${today}::date
    `.catch(() => {});

    if (res.ok) smsSent += 1;
    else smsFailed += 1;
  }

  /* ──────────────── 2. The monthly opening balance ──────────────────────── */

  const current = monthLabel(now);
  const upcoming = nextMonth(current);
  const assetStaff = employees.filter((u) =>
    resolveCapabilities(u.positions, u.capabilities).some((c) => c.key === "base_balance")
  );

  let baseBalanceReminders = 0;
  let escalated = false;

  const [existing] = await sql<{ month: string }[]>`
    select month from monthly_base_balances where month = ${upcoming}
  `.catch(() => []);

  // Every day of the closing window until it is filed, not just the first.
  // The count is taken once a month, so one missed message used to mean the
  // month opened with no opening balance at all.
  const inWindow = isBaseBalanceReminderWindow(now);
  const daysLeft = daysLeftInMonth(now);

  if (inWindow && !existing) {
    const urgency =
      daysLeft === 0
        ? `⚠️ <b>ዛሬ የወሩ የመጨረሻ ቀን ነው።</b>`
        : `⏳ ${daysLeft} ቀን ቀርቷል።`;
    const text =
      `📊 <b>የ${upcoming} የመነሻ ሚዛን</b>\n\n` +
      `ወሩ ከመጀመሩ በፊት የሁሉንም ምርቶች፣ የጥሬ ዕቃና የPP ከረጢት የመነሻ ሚዛን (ቀሪ ብዛት) ያስገቡ።\n` +
      `${urgency}\n\n` +
      `📊 "የወሩ የመነሻ ሚዛን" የሚለውን ይጫኑ።`;

    // Sent to every asset reporter with a known chat, signed in or not. Being
    // logged out is a reason to be told the count is due — the reminder is what
    // prompts signing back in — and silently skipping them is how the month
    // opened empty with nobody aware.
    await Promise.all(
      assetStaff.map(async (u) => {
        const res = await sendMessage(String(u.chat_id), text).catch(() => null);
        if (res?.ok) {
          baseBalanceReminders += 1;
          await logActivity({
            chatId: String(u.chat_id),
            actor: u.full_name,
            userId: u.id,
            positions: u.positions,
            audience: "internal",
            action: "reminder_sent",
            detail: `base balance ${upcoming} · ${daysLeft} day(s) left`,
          }).catch(() => {});
        }
      })
    );

    // Nobody to ask. HR and Admin have to hear this DURING the window, while
    // there is still time to act — not on the 1st when the month is already
    // open and the report is already blocked.
    if (assetStaff.length === 0) {
      const noone =
        `⚠️ <b>የ${upcoming} የመነሻ ሚዛን ማን እንደሚያስገባ የለም</b>\n\n` +
        `የመነሻ ሚዛን የሚያስገባ ሠራተኛ አልተመደበም። እባክዎ በዳሽቦርዱ ላይ ይመድቡ።`;
      await Promise.all(
        employees
          .filter((u) => hasPosition(u.positions, "hr") || hasPosition(u.positions, "admin"))
          .map((u) => sendMessage(String(u.chat_id), noone).catch(() => {}))
      );
    }
  }

  // The month has already opened and still nobody has filed it. HR and Admin
  // hear about it, and the dashboard raises it as an exception (see
  // detectExceptions), because the whole monthly report is blocked without it.
  const [openMonth] = await sql<{ month: string }[]>`
    select month from monthly_base_balances where month = ${current}
  `.catch(() => []);

  // Bounded to the first days of the month. Without the bound this fired every
  // single day a month went unfiled — an alert that arrives daily for four weeks
  // stops being read long before the person who could act on it sees it, and by
  // then it is also drowning out the reminder that still matters.
  const dayOfMonth = eatDayOfMonth(now);
  const escalationWindow = dayOfMonth <= ESCALATION_DAYS;

  if (!openMonth && escalationWindow) {
    const alert =
      `⚠️ <b>የ${current} የመነሻ ሚዛን አልገባም</b>\n\n` +
      `ወሩ ተጀምሯል፤ ነገር ግን የመነሻ ሚዛን አልተመዘገበም። የወሩ የፋይናንስ ሪፖርት እስኪገባ ድረስ አይሰላም።\n\n` +
      `የንብረት ክፍል "የወሩ የመነሻ ሚዛን" የሚለውን እንዲጫኑ ያስታውሱ።`;
    const recipients = employees.filter(
      (u) => hasPosition(u.positions, "hr") || hasPosition(u.positions, "admin")
    );
    await Promise.all(recipients.map((u) => sendMessage(String(u.chat_id), alert).catch(() => {})));
    escalated = recipients.length > 0;

    // The asset team is asked again too. The window has passed, but the count is
    // still the thing standing between them and a monthly report.
    await Promise.all(
      assetStaff.map((u) =>
        sendMessage(
          String(u.chat_id),
          `📊 <b>የ${current} የመነሻ ሚዛን ገና አልገባም</b>\n\nእባክዎ ዛሬ ያስገቡ — የወሩ ሪፖርት በዚህ ይጠብቃል።`
        ).catch(() => {})
      )
    );
  }

  /* ────────────── 3. Does the bag stock agree with the vouchers? ─────────── */

  // Sent to the two departments that can actually act on it: asset management
  // holds the stock and the issue vouchers, finance holds the purchases. The
  // owner sees the same gaps in the morning brief's exception list, so this is
  // deliberately not broadcast wider.
  let gapsFound = 0;
  try {
    const rec = await reconcileBags();
    gapsFound = rec.discrepancies.length;
    if (gapsFound > 0) {
      const text =
        `📦 <b>የPP ከረጢት ሒሳብ ልዩነት — ${rec.month}</b>\n\n` +
        rec.discrepancies.map((r) => `• ${describeGap(r)}`).join("\n") +
        `\n\n<i>የተቆጠረው ${rec.countedOn} ነው። የገባ/የወጣ ቫውቸር ተመዝግቦ እንደሆነ ያረጋግጡ።</i>`;
      const recipients = employees.filter((u) =>
        resolveCapabilities(u.positions, u.capabilities).some(
          (c) => c.key === "store_issue" || c.key === "grv"
        )
      );
      await Promise.all(recipients.map((u) => sendMessage(String(u.chat_id), text).catch(() => {})));
    }
  } catch (e) {
    // The voucher tables arrive in 0019; the WHT chase above must still run.
    console.warn("finance-daily: bag reconciliation unavailable", e);
  }

  return NextResponse.json({
    ok: true,
    date: today,
    bagGaps: gapsFound,
    sms: {
      configured: smsGatewayConfigured(),
      pendingHolders: holders.length,
      sent: smsSent,
      failed: smsFailed,
      alreadySentToday: smsSkipped,
    },
    baseBalance: {
      month: upcoming,
      inReminderWindow: inWindow,
      daysLeftInMonth: daysLeft,
      assetReportersReachable: assetStaff.length,
      alreadyFiled: Boolean(existing),
      reminded: baseBalanceReminders,
      currentMonthMissing: !openMonth,
      escalated,
    },
  });
}
