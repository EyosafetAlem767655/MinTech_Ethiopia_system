import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { latestBrief as fetchLatestBrief } from "@/lib/brief";
import {
  bestAndWorstDays,
  damageTripwires,
  detectExceptions,
  getDailySeries,
  getLotGaps,
  getYesterdayNumbers,
  missingWithholding,
  monthOnMonthFrom,
  pendingPurchaseRequests,
  receivablesAging,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  // One 90-day fetch serves every window the dashboard needs. Previously this
  // route ran getDailySeries five separate times (7/30/90 + two more inside
  // monthOnMonth) — and because the pool is small those queries queued up
  // rather than running side by side, which is what pushed the route past the
  // function time limit and produced a 504.
  const series90 = await getDailySeries(90);
  const series30 = series90.slice(-30);
  const series7 = series90.slice(-7);
  const mom = monthOnMonthFrom(series90);

  // These are needed both for the payload and by detectExceptions, so fetch
  // them once and hand them down rather than letting it re-query.
  const [aging, flaggedLots] = await Promise.all([receivablesAging(), getLotGaps()]);

  // Start of today in East Africa Time, for the sales-of-the-day summary.
  const eatMidnight = new Date(`${new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00+03:00`);

  const [
    yesterday,
    exceptions,
    withholding,
    prs,
    latestBrief,
    pendingClaimsRows,
    tripwires,
    salesTodayRows,
  ] = await Promise.all([
    getYesterdayNumbers(),
    detectExceptions(new Date(), { aging, lotGaps: flaggedLots }),
    missingWithholding(),
    pendingPurchaseRequests(),
    fetchLatestBrief(),
    sql<{ n: string }[]>`select count(*) as n from damage_claims where status in ('pending','cosign_required')`,
    damageTripwires(),
    sql<{ n: string; grand: string; net: string; wht: string }[]>`
      select count(*) as n,
             coalesce(sum(grand_total), 0) as grand,
             coalesce(sum(net_pay), 0) as net,
             coalesce(sum(withhold), 0) as wht
        from sales_receipts
       where status = 'submitted' and created_at >= ${eatMidnight}
    `,
  ]);
  const pendingClaims = Number(pendingClaimsRows[0]?.n) || 0;
  const s = salesTodayRows[0];
  const salesToday = {
    count: Number(s?.n) || 0,
    grandTotal: Number(s?.grand) || 0,
    netPayable: Number(s?.net) || 0,
    withholding: Number(s?.wht) || 0,
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
    receivables: aging,
    missingWithholding: withholding,
    purchaseRequests: prs,
    brief: latestBrief,
    flaggedLots,
    pendingClaims,
    tripwires,
    salesToday,
  });
}
