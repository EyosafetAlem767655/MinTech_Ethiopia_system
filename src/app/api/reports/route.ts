import { NextRequest, NextResponse } from "next/server";
import { getDepartmentReport } from "@/lib/department-metrics";
import { isDepartmentKey } from "@/lib/departments";
import { isRangeKey } from "@/lib/ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/reports?dept=<key>&range=<key> — one department's windowed report. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dept = searchParams.get("dept");
  const range = searchParams.get("range") ?? "weekly";

  if (!isDepartmentKey(dept)) {
    return NextResponse.json({ error: "Unknown department" }, { status: 400 });
  }
  if (!isRangeKey(range)) {
    return NextResponse.json({ error: "Unknown range" }, { status: 400 });
  }

  const report = await getDepartmentReport(dept, range);
  return NextResponse.json(report);
}
