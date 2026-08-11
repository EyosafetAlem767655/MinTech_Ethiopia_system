import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — recent finished-goods delivery reports (Sales). */
export async function GET() {
  const rows = await sql<
    {
      _id: string;
      date: Date;
      customer: string;
      invoiceNo: string | null;
      paymentType: string | null;
      qty: string | null;
      deliveryNo: string | null;
      reportedBy: string;
      products: Record<string, number>;
      createdAt: Date;
    }[]
  >`
    select id as _id, date, customer, invoice_no as "invoiceNo", payment_type as "paymentType",
           qty, delivery_no as "deliveryNo", reported_by as "reportedBy", products, created_at as "createdAt"
      from delivery_reports
     order by date desc, created_at desc
     limit 200
  `;
  return NextResponse.json(rows.map((r) => ({ ...r, qty: r.qty == null ? null : Number(r.qty) })));
}
