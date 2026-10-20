import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { isRangeKey, rangeWindow } from "@/lib/ranges";
import { rawMaterialCheck } from "@/lib/raw-material-stock";

export const dynamic = "force-dynamic";

/**
 * GET — the daily raw-material reports in a window, plus this month's stock
 * check.
 *
 * Filtered in SQL rather than client-side: a year of daily rows is a legitimate
 * thing to ask for, and a flat cap would silently drop the oldest days from a
 * window the panel says it is showing in full.
 */
export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("range") || "monthly";
  const { start } = rangeWindow(isRangeKey(param) ? param : "monthly");

  const rows = await sql<Record<string, unknown>[]>`
    select id as _id, date, date_label as "dateLabel", received, issued, stock,
           reported_by as "reportedBy", created_at as "createdAt"
      from raw_material_daily
     where date >= ${start}
     order by date desc
     limit 500
  `.catch((e) => {
    // The table arrives in 0033. An empty panel that says so beats a 500 on the
    // whole asset tab.
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return null;
  });

  if (rows === null) return NextResponse.json({ rows: [], check: null, unavailable: true });

  const check = await rawMaterialCheck().catch(() => null);
  return NextResponse.json({ rows, check });
}
