import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { Brief, BagLot, DamageClaim } from "@/lib/models";
import {
  bestAndWorstDays,
  damageTripwires,
  detectExceptions,
  getDailySeries,
  getYesterdayNumbers,
  missingWithholding,
  monthOnMonth,
  pendingPurchaseRequests,
  receivablesAging,
} from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  await dbConnect();

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
    pendingClaims,
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
    Brief.findOne().sort({ date: -1 }).lean(),
    BagLot.find({ "balance.gap": { $gt: 0 } }).select("lotCode supplier balance handlers").lean(),
    DamageClaim.countDocuments({ status: { $in: ["pending", "cosign_required"] } }),
    damageTripwires(),
  ]);

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
