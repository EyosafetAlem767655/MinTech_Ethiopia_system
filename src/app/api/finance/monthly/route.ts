import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { buildFinanceReport, monthBounds, monthLabel } from "@/lib/finance-report";
import { storeNetWorth } from "@/lib/store-net-worth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Newest first: the current month back to `first`, at most 24. */
function monthsSince(first: string): string[] {
  const out: string[] = [];
  const [y, m] = monthLabel().split("-").map(Number);
  for (let i = 0; i < 24; i++) {
    const label = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    if (label < first) break;
    out.push(label);
  }
  return out;
}

/** GET ?month=YYYY-MM — the monthly production and raw-material finance tables. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("month") || "";
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : monthLabel();

  try {
    const [report, store, months] = await Promise.all([
      buildFinanceReport(month),
      // A store problem must not take the whole monthly report down.
      storeNetWorth(monthBounds(month).end).catch((e) => {
        console.error("storeNetWorth failed:", e);
        return null;
      }),
      // From the first month anyone filed for. A month nobody filed for is still
      // a month: it runs on what was carried in, so it stays in the picker.
      sql<{ month: string }[]>`
        select min(month) as month from (
          select month from monthly_base_balances
          union
          select month from monthly_price_lists
        ) m
      `.catch(() => []),
    ]);
    const available = monthsSince(months[0]?.month ?? month);
    return NextResponse.json({
      ...report,
      store,
      availableMonths: available.includes(month) ? available : [month, ...available],
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
