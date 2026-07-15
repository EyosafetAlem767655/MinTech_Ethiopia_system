import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { MINTECH_MODULES } from "@/lib/modules";
import { monthlySalesReport } from "@/lib/reports";
import { latestBrief } from "@/lib/brief";
import { missingWithholding, receivablesAging } from "@/lib/metrics";

export const dynamic = "force-dynamic";

const count = (rows: { n: string }[]) => Number(rows[0]?.n) || 0;

export async function GET() {
  const [lotsR, pendingClaimsR, pendingPurchasesR, aging, wht, receiptsR, monthly, brief, recentBadStoneR] =
    await Promise.all([
      sql<{ n: string }[]>`select count(*) as n from bag_lots`,
      sql<{ n: string }[]>`select count(*) as n from damage_claims where status in ('pending','cosign_required')`,
      sql<{ n: string }[]>`select count(*) as n from purchase_requests where status = 'pending'`,
      receivablesAging(),
      missingWithholding(),
      sql<{ n: string }[]>`select count(*) as n from receipts`,
      monthlySalesReport(),
      latestBrief(),
      sql<{ n: string }[]>`select count(*) as n from stone_deliveries where quality_grade = 'dark/weathered'`,
    ]);

  const lots = count(lotsR);
  const pendingClaims = count(pendingClaimsR);
  const pendingPurchases = count(pendingPurchasesR);
  const receipts = count(receiptsR);
  const recentBadStone = count(recentBadStoneR);
  const overdueTotal = aging.overdueClients.reduce((sum, row) => sum + row.outstanding, 0);

  return NextResponse.json({
    modules: MINTECH_MODULES,
    status: {
      M1: { lots, pendingClaims },
      M2: { pendingPurchases },
      M3: { overdueInvoices: aging.overdueClients.length, overdueTotal, missingWithholding: wht.length },
      M4: { receipts, month: monthly.month, revenueInvoiced: monthly.revenueInvoiced, receiptExpenses: monthly.receiptExpenses },
      M5: { latestBriefDate: brief?.date || null, exceptions: brief?.exceptions?.length || 0 },
      M6: { darkWeatheredLoads: recentBadStone },
    },
  });
}
