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
    `🪨 ${numbers.truckloads} ጭነቶች ድንጋይ ደርሷል`,
    `🏭 ${numbers.tonsProduced.toFixed(2)} ቶን ተሰርቷል`,
    `🤝 ${numbers.tonsSold.toFixed(2)} ቶን ተሸጧል · ${etb(numbers.revenueInvoiced)} ብር ደረሰኝ ተቋቁሟል`,
    `💵 ${etb(numbers.cashCollected)} ብር ተሰብስቧል`,
    `🛡 ${numbers.damagedClaimed} ከረጢቶች ጉዳት ተጠይቋል · ${numbers.damagedVerified} ተረጋግጧል`,
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
