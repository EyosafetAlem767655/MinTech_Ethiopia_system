import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — recent finished-goods delivery reports (Sales). */
export async function GET() {
  // invoice_cash / invoice_credit arrive in 0013. If a deployment is running
  // ahead of its migrations (42703), fall back to the pre-0013 columns so the
  // panel still renders instead of 500-ing.
  let rows: Record<string, unknown>[];
  try {
    rows = await sql<Record<string, unknown>[]>`
      select id as _id, date, customer, invoice_no as "invoiceNo", payment_type as "paymentType",
             invoice_cash as "invoiceCash", invoice_credit as "invoiceCredit",
             qty, delivery_no as "deliveryNo", reported_by as "reportedBy", products, created_at as "createdAt"
        from delivery_reports
       order by date desc, created_at desc
       limit 200
    `;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01") return NextResponse.json([]);
    if (code !== "42703") throw e;
    rows = await sql<Record<string, unknown>[]>`
      select id as _id, date, customer, invoice_no as "invoiceNo", payment_type as "paymentType",
             qty, delivery_no as "deliveryNo", reported_by as "reportedBy", products, created_at as "createdAt"
        from delivery_reports
       order by date desc, created_at desc
       limit 200
    `;
  }

  const numFields = ["qty", "invoiceCash", "invoiceCredit"] as const;
  return NextResponse.json(
    rows.map((r) => {
      const out = { ...r };
      for (const k of numFields) out[k] = r[k] == null ? null : Number(r[k]);
      return out;
    })
  );
}
