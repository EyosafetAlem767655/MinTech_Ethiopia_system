import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/**
 * GET — daily production reports (Date × product grid, with FGR No).
 *
 * Production was first recorded on the pasted daily ops report, in its
 * `delivered` map, before the guided production report existed. Those days
 * are included too — exactly the rule the Brief's tonnage already uses
 * (src/lib/metrics.ts): a day with a production report is read from it, and
 * the ops report only answers for a day that has none, so no day is counted
 * twice. Without them the Production tab showed nothing before the switch,
 * while the Brief's totals did.
 */
export async function GET() {
  // Grade 1 (0046) is read through to_jsonb so a database without the column
  // still answers, with no Grade 1 on any day.
  const rows = await sql`
    select p.id as _id, p.date, p.fgr_no as "fgrNo", p.reported_by as "reportedBy", p.products,
           to_jsonb(p) -> 'grade1' as grade1, p.created_at as "createdAt"
      from production_reports p
     order by p.date desc, p.created_at desc
     limit 2000
  `;

  const historic = await sql<
    { _id: string; date: Date; reportedBy: string; products: Record<string, number>; createdAt: Date }[]
  >`
    select o.id as _id, o.date, o.reported_by as "reportedBy", o.delivered as products, o.created_at as "createdAt"
      from daily_ops_reports o
     where o.delivered is not null and o.delivered::text <> '{}'
       and not exists (
         select 1 from production_reports p
          where (p.date at time zone 'Africa/Addis_Ababa')::date = (o.date at time zone 'Africa/Addis_Ababa')::date
       )
     order by o.date desc
     limit 2000
  `.catch(() => []);

  const merged = [
    ...rows,
    ...historic.map((h) => ({ ...h, fgrNo: null, source: "ops" as const })),
  ].sort((a, b) => +new Date(String(b.date)) - +new Date(String(a.date)));

  return NextResponse.json(merged);
}
