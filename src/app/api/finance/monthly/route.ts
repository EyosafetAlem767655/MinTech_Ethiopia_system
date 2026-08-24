import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { buildFinanceReport, monthLabel } from "@/lib/finance-report";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET ?month=YYYY-MM — the monthly production and raw-material finance tables. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("month") || "";
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : monthLabel();

  try {
    const [report, months] = await Promise.all([
      buildFinanceReport(month),
      // Which months can be looked at: any month someone has opened with a base
      // balance, or priced. Union rather than a date range, so the picker never
      // offers a month with nothing behind it.
      sql<{ month: string }[]>`
        select month from monthly_base_balances
        union
        select month from monthly_price_lists
        order by month desc
        limit 24
      `.catch(() => []),
    ]);
    const known = months.map((m) => m.month);
    return NextResponse.json({
      ...report,
      availableMonths: known.includes(month) ? known : [month, ...known],
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "42P01") {
      return NextResponse.json(
        { error: "The finance tables are not in this database yet — apply migration 0016_finance.sql." },
        { status: 503 }
      );
    }
    throw e;
  }
}
