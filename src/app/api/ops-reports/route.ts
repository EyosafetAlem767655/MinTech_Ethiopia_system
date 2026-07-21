import { NextResponse } from "next/server";
import { recentOpsReports } from "@/lib/ops-report";

export const dynamic = "force-dynamic";

export async function GET() {
  const reports = (await recentOpsReports(365)) as any[];

  // Collect all product names seen across all reports
  const productSet = new Set<string>();
  for (const r of reports) {
    for (const key of Object.keys(r.delivered || {})) productSet.add(key);
    for (const key of Object.keys(r.received || {})) productSet.add(key);
    for (const key of Object.keys(r.stock || {})) productSet.add(key);
  }
  const products = Array.from(productSet).sort();
  const latest = reports.length > 0 ? reports[reports.length - 1] : null;

  return NextResponse.json({ reports, products, latest });
}
