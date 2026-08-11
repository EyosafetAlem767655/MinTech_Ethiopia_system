import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — recent purchased-items reports (Asset Management). */
export async function GET() {
  const rows = await sql<
    {
      _id: string;
      date: Date;
      description: string;
      uom: string | null;
      qty: string | null;
      supplier: string | null;
      amount: string | null;
      costCenter: string | null;
      purchaser: string | null;
      reportedBy: string;
      createdAt: Date;
    }[]
  >`
    select id as _id, date, description, uom, qty, supplier, amount,
           cost_center as "costCenter", purchaser, reported_by as "reportedBy", created_at as "createdAt"
      from purchase_item_reports
     order by date desc, created_at desc
     limit 200
  `;
  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      qty: r.qty == null ? null : Number(r.qty),
      amount: r.amount == null ? null : Number(r.amount),
    }))
  );
}
