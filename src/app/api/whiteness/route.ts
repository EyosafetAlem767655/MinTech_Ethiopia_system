import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { isRangeKey, rangeWindow } from "@/lib/ranges";

export const dynamic = "force-dynamic";

/**
 * GET ?range=daily|weekly|monthly|d90 — the whiteness readings in that window.
 *
 * Filtered in SQL rather than in the panel. Ninety days of four checks a day,
 * across ten products and several lines, runs well past any flat row cap — so a
 * client-side filter over "the latest 500" would quietly show a partial quarter
 * while looking complete. The window decides what is fetched.
 *
 * The averages are NOT computed here. They are derived in the panel from these
 * same rows, so the table and the summary below it can never disagree about a
 * reading — and a corrected row moves both at once.
 */
export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("range") || "weekly";
  // An unknown range is a bug in a caller, not a reason to answer nothing:
  // fall back to the week, which is the panel's own default.
  const { start } = rangeWindow(isRangeKey(param) ? param : "weekly");

  try {
    const rows = await sql<Record<string, unknown>[]>`
      select id as "_id", date, date_label as "dateLabel", quarter,
             product_code as "productCode", line, readings, avg,
             reported_by as "reportedBy", created_at as "createdAt"
        from whiteness_checks
       where date >= ${start}
       order by date desc, quarter desc, product_code, line
       limit 1000
    `;
    return NextResponse.json({
      rows: rows.map((r) => ({ ...r, avg: r.avg === null ? null : Number(r.avg) })),
    });
  } catch (e) {
    // whiteness_checks arrives in 0022.
    if ((e as { code?: string })?.code === "42P01") {
      return NextResponse.json({ rows: [], unavailable: true });
    }
    throw e;
  }
}
