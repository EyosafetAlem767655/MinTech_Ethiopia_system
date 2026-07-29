import { NextRequest, NextResponse } from "next/server";
import { getAllDepartmentSummaries } from "@/lib/department-metrics";
import { isRangeKey } from "@/lib/ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/reports/summary?range=<key> — compact per-department summaries. */
export async function GET(req: NextRequest) {
  const range = new URL(req.url).searchParams.get("range") ?? "weekly";
  if (!isRangeKey(range)) {
    return NextResponse.json({ error: "Unknown range" }, { status: 400 });
  }
  const departments = await getAllDepartmentSummaries(range);
  return NextResponse.json({ range, departments });
}
