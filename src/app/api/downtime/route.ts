import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { isRangeKey, rangeWindow } from "@/lib/ranges";

export const dynamic = "force-dynamic";

/** GET — downtime reports in a window, newest first. */
export async function GET(req: Request) {
  const param = new URL(req.url).searchParams.get("range") || "monthly";
  const { start } = rangeWindow(isRangeKey(param) ? param : "monthly");

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

  /* Filed in the last week, dated before the window — otherwise invisible.
     A downtime report entered today for last month is in Settings and nowhere
     on this tab; the panel shows it as a notice with the window that would
     include it. Dates only: the figures stay out of the window they do not
     belong to. */
  const late = await sql<{ date: string }[]>`
    select date
      from downtime_reports
     where date < ${start}
       and created_at >= now() - interval '7 days'
     order by date desc
     limit 20
  `.catch(() => []);

  return NextResponse.json({ rows, late: late.map((r) => r.date) });
}
