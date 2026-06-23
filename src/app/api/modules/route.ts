import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { MINTECH_MODULES } from "@/lib/modules";
import { monthlySalesReport } from "@/lib/reports";
import {
  BagLot,
  DamageClaim,
  Brief,
  PurchaseRequest,
  Receipt,
  StoneDelivery,
} from "@/lib/models";
import { missingWithholding, receivablesAging } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  await dbConnect();

  const [lots, pendingClaims, pendingPurchases, aging, wht, receipts, monthly, brief, recentBadStone] =
    await Promise.all([
      BagLot.countDocuments(),
      DamageClaim.countDocuments({ status: { $in: ["pending", "cosign_required"] } }),
      PurchaseRequest.countDocuments({ status: "pending" }),
      receivablesAging(),
      missingWithholding(),
      Receipt.countDocuments(),
      monthlySalesReport(),
      Brief.findOne().sort({ date: -1 }).lean(),
      StoneDelivery.countDocuments({ qualityGrade: "dark/weathered" }),
    ]);

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
