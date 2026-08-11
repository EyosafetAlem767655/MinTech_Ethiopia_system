import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — recent monthly stock-status reports (latest first). */
export async function GET() {
  const rows = await sql`
    select id as _id, month, reported_by as "reportedBy", items, created_at as "createdAt"
      from stock_status_reports
     order by created_at desc
     limit 12
  `;
  return NextResponse.json(rows);
}
