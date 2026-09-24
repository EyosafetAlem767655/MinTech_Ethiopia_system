import { NextResponse } from "next/server";
import { reconcileBags } from "@/lib/stock-reconciliation";

export const dynamic = "force-dynamic";

/**
 * GET — the PP bag stock check for one month, on its own.
 *
 * /api/vouchers already returns this, but it returns 240 vouchers and all their
 * line items with it. The finance tab shows the check inside the monthly report
 * and nothing else from that payload, so asking for the whole voucher book to
 * render one seven-column table would be a lot of rows travelling for nothing.
 *
 * `month` is the report's own selected month, so the check always covers the
 * period named above it rather than always the current one.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("month");
  // Anything that is not a month label is ignored rather than rejected: the
  // helper's default (this month) is a sensible answer to a malformed question.
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : undefined;

  try {
    const reconciliation = await reconcileBags(month);
    return NextResponse.json({ reconciliation });
  } catch (e) {
    // The voucher tables arrive in 0019. A database one migration behind gets a
    // panel that says nothing is countable yet, not a 500 on the finance tab.
    console.warn("bag-reconciliation unavailable", e);
    return NextResponse.json({ reconciliation: null, unavailable: true });
  }
}
