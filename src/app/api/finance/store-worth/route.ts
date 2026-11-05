import { NextRequest, NextResponse } from "next/server";
import { monthBounds, monthLabel } from "@/lib/finance-report";
import { storeNetWorth } from "@/lib/store-net-worth";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET ?month=YYYY-MM — the store's net worth, per block, at the month's end.
 *
 * Asked for on its own by Finance → Monthly. Inside the monthly request it could
 * only be given a short time or hold the whole report up, and running out of time
 * made the section vanish with nothing to say why.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("month") || "";
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : monthLabel();
  try {
    return NextResponse.json(await storeNetWorth(monthBounds(month).end));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logError({ source: "finance/store-worth", kind: "store_net_worth_failed", message }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
