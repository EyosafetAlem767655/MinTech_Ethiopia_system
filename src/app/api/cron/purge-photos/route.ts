import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { purgeFinanceReceipts, purgeOldPhotos, purgePpBagPhotos } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Retention for uploaded images: delete the raw photos from the bucket once they
 * are older than 72 hours. The extracted data (sales reports, daily reports, …)
 * stays — only the heavy binary is reclaimed. Runs on a schedule (vercel.json)
 * and can be triggered manually with ?hours=N.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const hours = Math.max(1, Number(req.nextUrl.searchParams.get("hours")) || 72);
  const ppDaysRaw = req.nextUrl.searchParams.get("ppDays");
  const ppDays = ppDaysRaw === null ? 365 : Math.max(0, Number(ppDaysRaw) || 0);
  const finDaysRaw = req.nextUrl.searchParams.get("financeDays");
  const financeDays = finDaysRaw === null ? 730 : Math.max(0, Number(finDaysRaw) || 0);

  // Drain in batches so a large backlog can't blow the function time budget;
  // whatever isn't cleared this run is picked up on the next schedule.
  let deleted = 0;
  for (let i = 0; i < 20; i++) {
    const res = await purgeOldPhotos(hours);
    deleted += res.deleted;
    if (res.deleted === 0) break;
  }

  // PP bag damage evidence is kept far longer — it backs the duplicate check —
  // so it has its own sweep and is excluded from the one above.
  let ppDeleted = 0;
  for (let i = 0; i < 10; i++) {
    const res = await purgePpBagPhotos(ppDays);
    ppDeleted += res.deleted;
    if (res.deleted === 0) break;
  }

  // Purchase receipts back a money figure, so they outlive both sweeps above and
  // are excluded from the 72-hour one.
  let financeDeleted = 0;
  for (let i = 0; i < 10; i++) {
    const res = await purgeFinanceReceipts(financeDays);
    financeDeleted += res.deleted;
    if (res.deleted === 0) break;
  }

  // Telegram de-duplication rows only matter for as long as Telegram will retry
  // an update (minutes). Anything older is dead weight.
  const dedupe = await sql<{ count: string }[]>`
    with gone as (
      delete from telegram_updates where created_at < now() - interval '1 day' returning 1
    )
    select count(*)::text as count from gone`.catch((e) => {
    console.error("purge telegram_updates failed:", e);
    return [{ count: "0" }];
  });

  return NextResponse.json({
    ok: true,
    deleted,
    olderThanHours: hours,
    ppBagDeleted: ppDeleted,
    ppBagOlderThanDays: ppDays,
    financeReceiptsDeleted: financeDeleted,
    financeReceiptsOlderThanDays: financeDays,
    dedupeRowsDeleted: Number(dedupe[0]?.count || 0),
  });
}
