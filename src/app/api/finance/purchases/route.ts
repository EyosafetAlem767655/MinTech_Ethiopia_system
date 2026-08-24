import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { monthLabel } from "@/lib/finance-report";

export const dynamic = "force-dynamic";

/** GET — tool purchase batches with their items, newest first. */
export async function GET() {
  try {
    const [rows, rate] = await Promise.all([
      sql<Record<string, unknown>[]>`
        select b.id as _id, b.sr_no as "srNo", b.date, b.supplier, b.cost_center as "costCenter",
               b.purchaser, b.currency, b.total_amount as "totalAmount",
               b.reported_by as "reportedBy", b.photo_file_ids as "photoFileIds",
               b.receipt_check as "receiptCheck", b.created_at as "createdAt",
               coalesce(
                 (select jsonb_agg(jsonb_build_object(
                     'description', i.description, 'uom', i.uom, 'quantity', i.quantity)
                   order by i.position)
                    from finance_purchase_items i where i.batch_id = b.id),
                 '[]'::jsonb
               ) as items
          from finance_purchase_batches b
         order by b.date desc, b.sr_no desc
         limit 200
      `,
      // The dual ETB/USD total needs a rate. The current month's price list is
      // the company's own published figure, so the two screens cannot disagree.
      sql<{ usd_rate: string | null }[]>`
        select usd_rate from monthly_price_lists where month = ${monthLabel()}
      `.catch(() => []),
    ]);

    return NextResponse.json({
      usdRate: rate[0]?.usd_rate == null ? null : Number(rate[0].usd_rate),
      rows: rows.map((r) => ({
        ...r,
        srNo: Number(r.srNo) || 0,
        totalAmount: r.totalAmount == null ? null : Number(r.totalAmount),
      })),
    });
  } catch (e) {
    // The finance tables arrive in 0016 — render an empty panel, not a 500.
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json({ usdRate: null, rows: [] });
    throw e;
  }
}
