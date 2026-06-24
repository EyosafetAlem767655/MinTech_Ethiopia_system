import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { DailyOpsReport } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  await dbConnect();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const reports = await DailyOpsReport.find({ date: { $gte: cutoff } })
    .sort({ date: 1 })
    .lean();

  // Collect all product names seen across all reports
  const productSet = new Set<string>();
  for (const r of reports) {
    for (const key of Object.keys(r.delivered || {})) productSet.add(key);
    for (const key of Object.keys(r.received || {})) productSet.add(key);
    for (const key of Object.keys(r.stock || {})) productSet.add(key);
  }

  const products = Array.from(productSet).sort();

  // Latest report for current stock snapshot
  const latest = reports.length > 0 ? reports[reports.length - 1] : null;

  return NextResponse.json({ reports, products, latest });
}
