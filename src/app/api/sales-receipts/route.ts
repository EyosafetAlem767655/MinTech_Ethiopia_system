import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — sales receipts submitted to the dashboard (Sales tab). */
export async function GET() {
  const rows = await sql<Record<string, unknown>[]>`
    select id as _id, date, customer_name as "customerName",
           product_ty as "productTy", qty, unit_price as "unitPrice", sub_total as "subTotal",
           vat, grand_total as "grandTotal", withhold, net_pay as "netPay", remark,
           reported_by as "reportedBy", created_at as "createdAt"
      from sales_receipts
     where status = 'submitted'
     order by date desc, created_at desc
     limit 300
  `;
  const numFields = ["qty", "unitPrice", "subTotal", "vat", "grandTotal", "withhold", "netPay"] as const;
  return NextResponse.json(
    rows.map((r) => {
      const out = { ...r };
      for (const k of numFields) out[k] = r[k] == null ? null : Number(r[k]);
      return out;
    })
  );
}
