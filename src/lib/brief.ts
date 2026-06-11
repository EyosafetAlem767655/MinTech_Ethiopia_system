import { Brief } from "@/lib/models";
import { etb, yesterdayRange, eatDateLabel } from "@/lib/dates";
import { writeBriefNarrative } from "@/lib/llm";
import {
  detectExceptions,
  getYesterdayNumbers,
  monthOnMonth,
  pendingPurchaseRequests,
  receivablesAging,
  recomputeLotBalances,
} from "@/lib/metrics";
import { sendBriefMessage } from "@/lib/telegram";
import { broadcastPush } from "@/lib/push";

/**
 * Assembles the morning brief: recomputes lot balances (the daily job),
 * pulls yesterday's numbers from the database, detects exceptions, asks the
 * LLM for the narrative (words only — figures come straight from queries),
 * then pushes via Telegram + Web Push. Runs once a day from Vercel Cron.
 */
export async function assembleAndSendBrief(now = new Date()) {
  // Daily reconciliation job (kept inside the single Hobby-tier cron run).
  await recomputeLotBalances();

  const { start } = yesterdayRange(now);
  const dateLabel = eatDateLabel(start);

  const [numbers, exceptions, mom, aging, prs] = await Promise.all([
    getYesterdayNumbers(now),
    detectExceptions(now),
    monthOnMonth(now),
    receivablesAging(now),
    pendingPurchaseRequests(),
  ]);

  // "Yesterday in five lines" — figures rendered from queries, never the LLM.
  const fiveLines = [
    `🪨 ${numbers.truckloads} truckloads of stone received`,
    `🏭 ${numbers.sacksProduced} sacks produced`,
    `🤝 ${numbers.sacksSold} sacks sold · ${etb(numbers.revenueInvoiced)} invoiced`,
    `💵 ${etb(numbers.cashCollected)} cash collected`,
    `🛡 ${numbers.damagedClaimed} bags claimed damaged · ${numbers.damagedVerified} verified`,
  ];

  const totalOverdue = aging.overdueClients.reduce((a, c) => a + c.outstanding, 0);
  const narrative = await writeBriefNarrative({
    date: dateLabel,
    yesterday: numbers,
    exceptions,
    month_on_month_change_pct: mom.changePct,
    receivables: { total_overdue_etb: Math.round(totalOverdue), overdue_invoices: aging.overdueClients.length },
    purchase_requests_pending: prs.length,
  });

  const appUrl = process.env.APP_URL || "";

  // Telegram message: exceptions first, then the five lines, then narrative.
  const exceptionBlock =
    exceptions.length > 0
      ? `🚨 <b>Exceptions</b>\n${exceptions.map((e) => `• ${e}`).join("\n")}\n\n`
      : "✅ No exceptions yesterday.\n\n";
  const tg =
    `☀️ <b>Morning Brief — ${dateLabel}</b>\n\n` +
    exceptionBlock +
    `<b>Yesterday in five lines</b>\n${fiveLines.join("\n")}` +
    (narrative ? `\n\n<i>${narrative}</i>` : "");

  let sentTelegram = false;
  const ceoChat = process.env.TELEGRAM_CEO_CHAT_ID;
  if (ceoChat && process.env.TELEGRAM_BOT_TOKEN) {
    const res = await sendBriefMessage(ceoChat, tg, appUrl || "https://vercel.com");
    sentTelegram = !!res?.ok;
  }

  const pushRes = await broadcastPush({
    title: `☀️ Morning Brief — ${dateLabel}`,
    body:
      exceptions.length > 0
        ? `🚨 ${exceptions[0]}`
        : `${numbers.sacksProduced} sacks produced · ${etb(numbers.cashCollected)} collected. Tap for the full brief.`,
    url: "/",
    tag: `brief-${dateLabel}`,
  });

  const doc = await Brief.findOneAndUpdate(
    { date: dateLabel },
    {
      date: dateLabel,
      fiveLines,
      exceptions,
      narrative,
      numbers: numbers as unknown as Record<string, number>,
      sentTelegram,
      sentPush: pushRes.sent > 0,
    },
    { upsert: true, new: true }
  );

  return { date: dateLabel, exceptions, fiveLines, narrative, sentTelegram, push: pushRes, briefId: doc._id };
}
