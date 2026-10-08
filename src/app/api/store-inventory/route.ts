import { NextResponse } from "next/server";
import { groupStatuses, itemStatuses, recentCounts, storeMovements } from "@/lib/store-inventory";
import { costsAt } from "@/lib/store-costs";

export const dynamic = "force-dynamic";

/**
 * GET — what is on the shelf (the last count, moved on by the vouchers filed
 * since, and valued at today's cost), and when each group was last counted.
 *
 * Both are derived here rather than in the browser: the rule for "current
 * quantity" is the same rule the bot uses to pre-fill its template, and it may
 * only exist once.
 */
export async function GET() {
  const [counts, movements, costs] = await Promise.all([recentCounts(), storeMovements(), costsAt(new Date())]);
  return NextResponse.json({
    items: itemStatuses(counts, movements, costs),
    groups: groupStatuses(counts),
    counts: counts.length,
  });
}
