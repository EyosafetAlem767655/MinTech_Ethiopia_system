import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { isRangeKey, rangeWindow } from "@/lib/ranges";

export const dynamic = "force-dynamic";

/** GET — downtime reports in a window, newest first. */
export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("range") || "weekly";
  const { start } = rangeWindow(isRangeKey(param) ? param : "weekly");

  const rows = await sql<Record<string, unknown>[]>`
    select id as _id, date, date_label as "dateLabel", hours, reason,
           maintenance_kind as "maintenanceKind", note,
           reported_by as "reportedBy", created_at as "createdAt"
      from downtime_reports
     where date >= ${start}
     order by date desc, created_at desc
     limit 500
  `.catch((e) => {
    // The table arrives in 0035. An empty panel that says so beats a 500 that
    // takes the whole production tab down with it.
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return null;
  });

  if (rows === null) return NextResponse.json({ rows: [], unavailable: true });
  return NextResponse.json({ rows });
}
