import { NextResponse } from "next/server";
import { groupStatuses, itemStatuses, recentCounts } from "@/lib/store-inventory";

export const dynamic = "force-dynamic";

/**
 * GET — what is on the shelf, and when each group was last counted.
 *
 * Both are derived from the counts here rather than in the browser: the rule
 * for "current quantity" (the newest count that included this item) is the same
 * rule the bot uses to pre-fill its template, and it may only exist once.
 */
export async function GET() {
  const counts = await recentCounts();
  return NextResponse.json({
    items: itemStatuses(counts),
    groups: groupStatuses(counts),
    counts: counts.length,
  });
}
