import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { latestBrief as fetchLatestBrief } from "@/lib/brief";
import { runAfter } from "@/lib/after";
import { dailyHeartbeat } from "@/lib/heartbeat";
import {
  bestAndWorstDays,
  damageTripwires,
  detectExceptions,
  getDailySeries,
  getLotGaps,
  getYesterdayNumbers,
  monthOnMonthFrom,
  pendingPurchaseRequests,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";
// Raised because the daily heartbeat now finishes behind this response. The
// dashboard payload itself is unchanged and still returns in its own time —
// nothing here waits on the background half.
export const maxDuration = 120;

export async function GET() {
  // The second place the day's work can start, after the Telegram webhook.
  // Neither is a scheduler, so between them the WHT chase happens on whichever
  // comes first — someone messaging the bot, or someone opening the dashboard.
  // Sending twice is impossible: chaseHolder claims the day in wht_sms_log
  // before it sends.
  runAfter(dailyHeartbeat());

  // One 90-day fetch serves every window the dashboard needs. Previously this
  // route ran getDailySeries five separate times (7/30/90 + two more inside
  // monthOnMonth) — and because the pool is small those queries queued up
  // rather than running side by side, which is what pushed the route past the
  // function time limit and produced a 504.
  const series90 = await getDailySeries(90);
  const series30 = series90.slice(-30);
  const series7 = series90.slice(-7);
  const mom = monthOnMonthFrom(series90);

  // Needed both for the payload and by detectExceptions, so fetch once and hand
  // it down rather than letting it re-query.
  const flaggedLots = await getLotGaps();

  // Start of today in East Africa Time, for the sales-of-the-day summary.
  const eatMidnight = new Date(`${new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00+03:00`);

  const [
    yesterday,
    exceptions,
    prs,
    latestBrief,
    pendingClaimsRows,
    tripwires,
    salesTodayRows,
  ] = await Promise.all([
    getYesterdayNumbers(),
    detectExceptions(new Date(), { lotGaps: flaggedLots }),
    pendingPurchaseRequests(),
    fetchLatestBrief(),
    sql<{ n: string }[]>`select count(*) as n from damage_claims where status in ('pending','cosign_required')`,
    damageTripwires(),
    // Guarded: daily_sales_summaries may not be migrated yet — don't let a
    // missing table break the whole brief.
    //
    // Withholding is gone from this line, not zeroed by accident: the report is
    // now the till's payment summary, which has no withholding column. What is
    // outstanding in WHT receipts is its own panel, fed by wht_holders.
    sql<{ n: string; grand: string; net: string }[]>`
      select count(*) as n,
             coalesce(sum(total_payment), 0) as grand,
             coalesce(sum(net_total), 0) as net
        from daily_sales_summaries
       where created_at >= ${eatMidnight}
    `.catch(() => [{ n: "0", grand: "0", net: "0" }]),
  ]);
  const pendingClaims = Number(pendingClaimsRows[0]?.n) || 0;
  const s = salesTodayRows[0];
  const salesToday = {
    count: Number(s?.n) || 0,
    grandTotal: Number(s?.grand) || 0,
    netPayable: Number(s?.net) || 0,
    withholding: 0,
  };

  return NextResponse.json({
    yesterday,
    exceptions,
    series: { d7: series7, d30: series30, d90: series90 },
    bestWorst: {
      production: bestAndWorstDays(series30, "production"),
      sales: bestAndWorstDays(series30, "sales"),
      collections: bestAndWorstDays(series30, "collections"),
    },
    monthOnMonth: mom,
    purchaseRequests: prs,
    brief: latestBrief,
    flaggedLots,
    pendingClaims,
    tripwires,
    salesToday,
  });
}
