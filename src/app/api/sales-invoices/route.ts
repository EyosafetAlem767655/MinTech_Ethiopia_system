import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/**
 * GET — the sales sheet, one row per sale, newest first.
 *
 * No photograph anywhere in this: a sale's receipts are read once by the bot
 * and never stored or referenced, so the columns below are the whole record.
 */
export async function GET() {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select id as _id, date, date_label as "dateLabel", customer,
             invoice_cash as "invoiceCash", invoice_credit as "invoiceCredit",
             qty, delivery_no as "deliveryNo", products, bank,
             extraction, reported_by as "reportedBy", created_at as "createdAt"
        from sales_invoices
       order by date desc, created_at desc
       limit 300
    `;
    const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
    return NextResponse.json(
      rows.map((r) => ({
        ...r,
        invoiceCash: num(r.invoiceCash),
        invoiceCredit: num(r.invoiceCredit),
        qty: num(r.qty),
        products: (r.products as Record<string, number>) || {},
      }))
    );
  } catch (e) {
    // The table arrives in 0027 — an empty panel, never a 500.
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json([]);
    throw e;
  }
}
