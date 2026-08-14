import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { buildSalesReceiptsWorkbook, type SalesReceiptRow } from "@/lib/receipt-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET — download the submitted sales receipts as the Cash Sales Excel report. */
export async function GET() {
  const rows = await sql`
    select date, customer_name as "customerName", fs_no as "fsNo", att_no as "attNo",
           product_ty as "productTy", qty, unit_price as "unitPrice", sub_total as "subTotal",
           vat, grand_total as "grandTotal", withhold, net_pay as "netPay",
           deposited_bank as "depositedBank", remark
      from sales_receipts
     where status = 'submitted'
     order by date asc, created_at asc
  `;
  const buf = await buildSalesReceiptsWorkbook(rows as unknown as SalesReceiptRow[], "Sales Report — submitted");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="mintech-sales-report.xlsx"',
    },
  });
}
