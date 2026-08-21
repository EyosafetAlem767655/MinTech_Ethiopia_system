import sql, { jsonb } from "@/lib/sql";
import { etb, yesterdayRange, eatDateLabel } from "@/lib/dates";
import { writeBriefNarrative } from "@/lib/llm";
import {
  detectExceptions,
  getYesterdayNumbers,
  monthOnMonth,
  pendingPurchaseRequests,
  receivablesAging,
} from "@/lib/metrics";
import { sendBriefMessage } from "@/lib/telegram";
import { broadcastPush } from "@/lib/push";

/**
 * Assembles the morning brief: pulls yesterday's numbers, detects exceptions,
 * asks the LLM for the narrative (words only — figures come straight from
 * queries), then pushes via Telegram + Web Push. Runs daily from Vercel Cron.
 *
 * The old lot-balance reconciliation step is gone: balances are now derived by
 * the v_lot_balances view, so there is nothing to recompute.
 */
export async function assembleAndSendBrief(now = new Date()) {
  const { start, end } = yesterdayRange(now);
  const dateLabel = eatDateLabel(start);

  const [numbers, exceptions, mom, aging, prs, submissions] = await Promise.all([
    getYesterdayNumbers(now),
    detectExceptions(now),
    monthOnMonth(now),
    receivablesAging(now),
    pendingPurchaseRequests(),
    // What staff actually filed yesterday. Guarded so a missing table can never
    // take the whole brief down with it.
    sql<{ daily: string; hr: string; materials: string }[]>`
      select
        (select count(*) from daily_reports   where created_at >= ${start} and created_at < ${end}) as daily,
        (select count(*) from hr_reports      where created_at >= ${start} and created_at < ${end}) as hr,
        (select count(*) from material_counts where created_at >= ${start} and created_at < ${end}) as materials
    `.catch(() => [{ daily: "0", hr: "0", materials: "0" }]),
  ]);

  // "Yesterday in five lines" — figures rendered from queries, never the LLM.
  const fiveLines = [
    `🏭 ${numbers.tonsProduced.toFixed(2)} ቶን ተሰርቷል`,
    `🤝 ${numbers.tonsSold.toFixed(2)} ቶን ተሸጧል · ${etb(numbers.revenueInvoiced)} ብር ደረሰኝ ተቋቁሟል`,
    `💵 ${etb(numbers.cashCollected)} ብር ተሰብስቧል`,
    `🛡 ${numbers.damagedClaimed} ከረጢቶች ጉዳት ተጠይቋል · ${numbers.damagedVerified} ተረጋግጧል`,
  ];

  // Department lines are appended only when there is something to say, so the
  // brief never carries permanent "0" lines on days a team doesn't file.
  if (numbers.salesReportsCount > 0) {
    fiveLines.push(
      `🧾 ${numbers.salesReportsCount} የሽያጭ ሪፖርት · ${etb(numbers.salesReportedEtb)} ብር ጠቅላላ · ${etb(
        numbers.salesReportedNetEtb
      )} ብር ተጣራ`
    );
  }
  if (numbers.rawMaterialLoads > 0) {
    fiveLines.push(
      `🚚 ${numbers.rawMaterialTons.toFixed(2)} ቶን ጥሬ ዕቃ ገብቷል · ${numbers.rawMaterialLoads} ጭነት`
    );
  }
  if (numbers.deliveryCount > 0) {
    fiveLines.push(`🚛 ${numbers.deliveredTons.toFixed(2)} ቶን ተላልፏል · ${numbers.deliveryCount} ማድረሻ`);
  }
  if (numbers.openToolRequests > 0) {
    fiveLines.push(`🔧 ${numbers.openToolRequests} የመሣሪያ ግዢ ጥያቄ ውሳኔ ይጠብቃል`);
  }

  const totalOverdue = aging.overdueClients.reduce((a, c) => a + c.outstanding, 0);
  const narrative = await writeBriefNarrative({
    date: dateLabel,
    yesterday: numbers,
    exceptions,
    month_on_month_change_pct: mom.changePct,
    receivables: { total_overdue_etb: Math.round(totalOverdue), overdue_invoices: aging.overdueClients.length },
    purchase_requests_pending: prs.length,
    sales_team_reports: {
      count: numbers.salesReportsCount,
      grand_total_etb: Math.round(numbers.salesReportedEtb),
      net_payable_etb: Math.round(numbers.salesReportedNetEtb),
    },
    asset_management: {
      raw_material_tons: numbers.rawMaterialTons,
      raw_material_loads: numbers.rawMaterialLoads,
      delivered_tons: numbers.deliveredTons,
      deliveries: numbers.deliveryCount,
      open_tool_requests: numbers.openToolRequests,
    },
    staff_submissions: {
      daily_reports: Number(submissions[0]?.daily) || 0,
      hr_reports: Number(submissions[0]?.hr) || 0,
      material_counts: Number(submissions[0]?.materials) || 0,
    },
  });

  const appUrl = process.env.APP_URL || "";

  // Telegram message: exceptions first, then the five lines, then narrative.
  const exceptionBlock =
    exceptions.length > 0
      ? `🚨 <b>ልዩ ሁኔታዎች</b>\n${exceptions.map((e) => `• ${e}`).join("\n")}\n\n`
      : "✅ ትናንት ምንም ልዩ ሁኔታ አልነበረም።\n\n";
  const tg =
    `☀️ <b>የጠዋት ሪፖርት — ${dateLabel}</b>\n\n` +
    exceptionBlock +
    `<b>ትናንት በአምስት ዓረፍተ ነገሮች</b>\n${fiveLines.join("\n")}` +
    (narrative ? `\n\n<i>${narrative}</i>` : "");

  let sentTelegram = false;
  const ceoChat = process.env.TELEGRAM_CEO_CHAT_ID;
  if (ceoChat && process.env.TELEGRAM_BOT_TOKEN) {
    const res = await sendBriefMessage(ceoChat, tg, appUrl || "https://vercel.com");
    sentTelegram = !!res?.ok;
  }

  const pushRes = await broadcastPush({
    title: `☀️ የጠዋት ሪፖርት — ${dateLabel}`,
    body:
      exceptions.length > 0
        ? `🚨 ${exceptions[0]}`
        : `${numbers.tonsProduced.toFixed(2)} ቶን ተሰርቷል · ${etb(numbers.cashCollected)} ብር ተሰብስቧል። ሙሉ ሪፖርቱን ለማየት ይጫኑ።`,
    url: "/",
    tag: `brief-${dateLabel}`,
  });

  const [doc] = await sql<{ id: string }[]>`
    insert into briefs (date, five_lines, exceptions, narrative, numbers, sent_telegram, sent_push)
    values (${dateLabel}, ${fiveLines}, ${exceptions}, ${narrative},
            ${jsonb(numbers as unknown as Record<string, unknown>)},
            ${sentTelegram}, ${pushRes.sent > 0})
    on conflict (date) do update set
      five_lines    = excluded.five_lines,
      exceptions    = excluded.exceptions,
      narrative     = excluded.narrative,
      numbers       = excluded.numbers,
      sent_telegram = excluded.sent_telegram,
      sent_push     = excluded.sent_push,
      updated_at    = now()
    returning id
  `;

  return { date: dateLabel, exceptions, fiveLines, narrative, sentTelegram, push: pushRes, briefId: doc.id };
}

export async function latestBrief() {
  const rows = await sql`
    select id as _id, date, five_lines as "fiveLines", exceptions, narrative, numbers,
           sent_telegram as "sentTelegram", sent_push as "sentPush", created_at as "createdAt"
      from briefs
     order by date desc
     limit 1
  `;
  return rows[0] ?? null;
}
