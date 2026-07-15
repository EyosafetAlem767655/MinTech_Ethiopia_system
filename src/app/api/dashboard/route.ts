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
  monthOnMonth,
  pendingPurchaseRequests,
  receivablesAging,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const [
    yesterday,
    exceptions,
    series7,
    series30,
    series90,
    mom,
    aging,
    withholding,
    prs,
    latestBrief,
    flaggedLots,
    pendingClaimsRows,
    tripwires,
  ] = await Promise.all([
    getYesterdayNumbers(),
    detectExceptions(),
    getDailySeries(7),
    getDailySeries(30),
    getDailySeries(90),
    monthOnMonth(),
    receivablesAging(),
    missingWithholding(),
    pendingPurchaseRequests(),
    fetchLatestBrief(),
    getLotGaps(),
    sql<{ n: string }[]>`select count(*) as n from damage_claims where status in ('pending','cosign_required')`,
    damageTripwires(),
  ]);
  const pendingClaims = Number(pendingClaimsRows[0]?.n) || 0;

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
  });
}
