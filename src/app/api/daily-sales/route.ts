import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — the day's payment summary, one row per day, newest first. */
export async function GET() {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select id as _id, date, date_label as "dateLabel",
             cash_payment    as "cashPayment",    cash_refund    as "cashRefund",
             cheque_payment  as "chequePayment",  cheque_refund  as "chequeRefund",
             card_payment    as "cardPayment",    card_refund    as "cardRefund",
             credit_payment  as "creditPayment",  credit_refund  as "creditRefund",
             voucher_payment as "voucherPayment", voucher_refund as "voucherRefund",
             total_payment as "totalPayment", total_refund as "totalRefund",
             net_total as "netTotal", printed_total as "printedTotal",
             tg_file_ids as "tgFileIds", extraction, reported_by as "reportedBy",
             created_at as "createdAt"
        from daily_sales_summaries
       order by date desc
       limit 180
    `;

    const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
    return NextResponse.json(
      rows.map((r) => ({
        ...r,
        cashPayment: num(r.cashPayment),
        cashRefund: num(r.cashRefund),
        chequePayment: num(r.chequePayment),
        chequeRefund: num(r.chequeRefund),
        cardPayment: num(r.cardPayment),
        cardRefund: num(r.cardRefund),
        creditPayment: num(r.creditPayment),
        creditRefund: num(r.creditRefund),
        voucherPayment: num(r.voucherPayment),
        voucherRefund: num(r.voucherRefund),
        totalPayment: num(r.totalPayment),
        totalRefund: num(r.totalRefund),
        netTotal: num(r.netTotal),
        // Null, not 0, when nothing was printed: "no total on the receipt" and
        // "a printed total of zero" are different readings, and only the second
        // is worth flagging as a disagreement.
        printedTotal: r.printedTotal == null ? null : Number(r.printedTotal),
      }))
    );
  } catch (e) {
    // The table arrives in 0024 — an empty panel, never a 500.
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json([]);
    throw e;
  }
}
