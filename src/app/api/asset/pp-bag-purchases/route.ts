import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { monthLabel } from "@/lib/finance-report";

export const dynamic = "force-dynamic";

const EMPTY = { usdRate: null, rows: [] };

/**
 * GET — PP bag purchases, both departments' copies, newest first.
 *
 * Asset-filed rows carry the counts by size and colour; finance-filed rows carry
 * only the receipt. Both are returned and labelled, because the point of the
 * panel is to show them side by side: a delivery with a receipt but no count, or
 * a count with no receipt, is exactly what someone needs to see.
 */
export async function GET() {
  try {
    const [rows, rate] = await Promise.all([
      sql<Record<string, unknown>[]>`
        select id as _id, date, bags, supplier, dn_no as "dnNo", currency,
               total_amount as "totalAmount", reported_by as "reportedBy",
               filed_by_dept as "filedByDept", photo_file_ids as "photoFileIds",
               receipt_check as "receiptCheck", extraction, created_at as "createdAt"
          from pp_bag_purchases
         order by date desc, created_at desc
         limit 200
      `,
      // The dual ETB/USD total reads the company's own published rate for the
      // current month, so this panel and the finance tab cannot disagree.
      sql<{ usd_rate: string | null }[]>`
        select usd_rate from monthly_price_lists where month = ${monthLabel()}
      `.catch(() => []),
    ]);

    return NextResponse.json({
      usdRate: rate[0]?.usd_rate == null ? null : Number(rate[0].usd_rate),
      rows: rows.map((r) => ({
        ...r,
        totalAmount: r.totalAmount == null ? null : Number(r.totalAmount),
      })),
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // 42P01: the table arrives in 0016. 42703: the three columns arrive in 0017.
    // Either way an empty panel beats a 500 on a database that is one migration
    // behind the deploy.
    if (code === "42P01" || code === "42703") return NextResponse.json(EMPTY);
    throw e;
  }
}
