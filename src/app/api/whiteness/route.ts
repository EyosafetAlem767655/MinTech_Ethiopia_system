import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/**
 * GET — the whiteness readings, newest first.
 *
 * The weekly averages are NOT computed here. They are derived in the panel from
 * these same rows, so the table and the summary below it can never disagree
 * about a reading — and a corrected row moves both at once.
 */
export async function GET() {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select id as "_id", date, date_label as "dateLabel", quarter,
             product_code as "productCode", line, readings, avg,
             reported_by as "reportedBy", created_at as "createdAt"
        from whiteness_checks
       order by date desc, quarter desc, product_code, line
       limit 500
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
