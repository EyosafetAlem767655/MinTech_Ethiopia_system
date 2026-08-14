import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — sales receipts submitted to the dashboard (Sales tab). */
export async function GET() {
  // remark (0009) / receipt_check (0010) are optional columns; if a deployment is
  // running ahead of its migrations (42703), fall back to the core columns so the
  // panel still renders instead of 500-ing.
  let rows: Record<string, unknown>[];
  try {
    rows = await sql<Record<string, unknown>[]>`
      select id as _id, date, customer_name as "customerName", fs_no as "fsNo", att_no as "attNo",
             product_ty as "productTy", qty, unit_price as "unitPrice", sub_total as "subTotal",
             vat, grand_total as "grandTotal", withhold, net_pay as "netPay",
             deposited_bank as "depositedBank", remark,
             receipt_check as "receiptCheck", reported_by as "reportedBy", created_at as "createdAt"
        from sales_receipts
       where status = 'submitted'
       order by date desc, created_at desc
       limit 300
    `;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // Table not created yet (42P01) → nothing submitted; return empty.
    if (code === "42P01") return NextResponse.json([]);
    if (code !== "42703") throw e;
    // Optional columns not migrated yet → fall back to the core columns.
    rows = await sql<Record<string, unknown>[]>`
      select id as _id, date, customer_name as "customerName", fs_no as "fsNo", att_no as "attNo",
             product_ty as "productTy", qty, unit_price as "unitPrice", sub_total as "subTotal",
             vat, grand_total as "grandTotal", withhold, net_pay as "netPay",
             deposited_bank as "depositedBank",
             reported_by as "reportedBy", created_at as "createdAt"
        from sales_receipts
       where status = 'submitted'
       order by date desc, created_at desc
       limit 300
    `;
  }
  const numFields = ["qty", "unitPrice", "subTotal", "vat", "grandTotal", "withhold", "netPay"] as const;
  return NextResponse.json(
    rows.map((r) => {
      const out = { ...r };
      for (const k of numFields) out[k] = r[k] == null ? null : Number(r[k]);
      return out;
    })
  );
}
