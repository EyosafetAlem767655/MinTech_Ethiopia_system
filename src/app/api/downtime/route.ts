import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/**
 * GET — the Production Hours Report, month by month (the last 12 filed).
 *
 * One entry per month, each with its production lines in sheet order: hours
 * (as minutes) and days working, stopped by power, by mechanical or electrical
 * maintenance, for want of raw material, and the total.
 */
export async function GET() {
  const rows = await sql<Record<string, string | number>[]>`
    select month, line,
           working_minutes, working_days, power_minutes, power_days, mech_minutes, mech_days,
           elec_minutes, elec_days, raw_minutes, raw_days, total_minutes, total_days,
           reported_by, updated_at
      from production_hours
     where month in (select distinct month from production_hours order by month desc limit 12)
     order by month desc, line
  `.catch((e) => {
    // The table arrives in 0040 — an empty panel that says so, never a 500
    // that takes the whole production tab down with it.
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return null;
  });
  if (rows === null) return NextResponse.json({ months: [], unavailable: true });

  const n = (v: unknown) => Number(v) || 0;
  const cell = (r: Record<string, string | number>, k: string) => ({ minutes: n(r[`${k}_minutes`]), days: n(r[`${k}_days`]) });
  const byMonth = new Map<string, { month: string; reportedBy: string; lines: unknown[] }>();
  for (const r of rows) {
    const month = String(r.month);
    const m = byMonth.get(month) ?? { month, reportedBy: String(r.reported_by), lines: [] };
    m.lines.push({
      line: n(r.line),
      cells: Object.fromEntries(["working", "power", "mech", "elec", "raw", "total"].map((k) => [k, cell(r, k)])),
    });
    byMonth.set(month, m);
  }
  return NextResponse.json({ months: [...byMonth.values()] });
}
