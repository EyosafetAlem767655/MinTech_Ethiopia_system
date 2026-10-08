import { NextRequest, NextResponse } from "next/server";
import { SALES_ANALYTICS_RANGES, salesAnalytics } from "@/lib/sales-analytics";
import { isRangeKey } from "@/lib/ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET ?range=weekly|monthly|d90|d180|yearly — the Sales tab's customer analytics. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("range") || "monthly";
  // Only the windows the tab offers; anything else falls back to the week
  // rather than 400-ing, since the value only ever comes from the tab's own
  // buttons and a stale link should still show something. The fallback is the
  // tab's own default, so a first paint without a param agrees with its pills.
  const range = isRangeKey(raw) && SALES_ANALYTICS_RANGES.includes(raw) ? raw : "monthly";
  return NextResponse.json(await salesAnalytics(range));
}
