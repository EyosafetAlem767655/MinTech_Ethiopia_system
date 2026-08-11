import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — recent daily production reports (Date × product grid, with FGR No). */
export async function GET() {
  const rows = await sql`
    select id as _id, date, fgr_no as "fgrNo", reported_by as "reportedBy", products, created_at as "createdAt"
      from production_reports
     order by date desc, created_at desc
     limit 200
  `;
  return NextResponse.json(rows);
}
