import { GROUP_BY_KEY, STORE_BLOCKS } from "@/lib/store-items";
import { itemStatuses, recentCounts, storeMovements, type CountRow, type Movement } from "@/lib/store-inventory";
import { costsAt } from "@/lib/store-costs";
import { loadCustomStoreItems } from "@/lib/store-custom";

/**
 * What the spare-parts store is worth at the end of a month, per block
 * (Mechanical, Electrical, Oils & workshop): quantity remaining × unit cost.
 *
 * The same rule as the store tab (last count, moved on by the vouchers since),
 * cut off at the month's end so a past month reads what was on the shelf then,
 * at the prices in effect then. For the month in progress that is today.
 *
 * A negative balance is an issue with no count behind it, not stock owed, so it
 * adds nothing. An item with stock but no price adds nothing either, and is
 * counted in `unpriced` so the total can say what it leaves out.
 */

export interface StoreBlockWorth {
  key: string;
  label: string;
  icon: string;
  netWorth: number;
  /** Items with stock that have no unit cost yet. */
  unpriced: number;
}

export interface StoreNetWorth {
  blocks: StoreBlockWorth[];
  total: number;
  unpriced: number;
}

/** Pure, so the arithmetic can be tested without a database. */
export function storeNetWorthFrom(
  counts: CountRow[],
  movements: Movement[],
  costs: Map<string, { unitCost: number }>,
  end: Date
): StoreNetWorth {
  const cut = end.getTime();
  const statuses = itemStatuses(
    counts.filter((c) => new Date(c.date).getTime() < cut),
    movements.filter((m) => new Date(m.date).getTime() < cut),
    costs
  );

  const blocks = STORE_BLOCKS.map<StoreBlockWorth>((b) => ({ ...b, netWorth: 0, unpriced: 0 }));
  for (const s of statuses) {
    if (s.balance <= 0) continue;
    const block = blocks.find((b) => b.key === GROUP_BY_KEY.get(s.item.group)?.block);
    if (!block) continue;
    if (s.unitCost) block.netWorth += s.balance * s.unitCost;
    else block.unpriced += 1;
  }
  for (const b of blocks) b.netWorth = Math.round(b.netWorth * 100) / 100;

  return {
    blocks,
    total: Math.round(blocks.reduce((a, b) => a + b.netWorth, 0) * 100) / 100,
    unpriced: blocks.reduce((a, b) => a + b.unpriced, 0),
  };
}

/** `end` is the month's end (finance-report.ts `monthBounds`). */
export async function storeNetWorth(end: Date, now = new Date()): Promise<StoreNetWorth> {
  await loadCustomStoreItems();
  const asOf = new Date(Math.min(end.getTime() - 1, now.getTime()));
  const [counts, movements, costs] = await Promise.all([recentCounts(), storeMovements(), costsAt(asOf)]);
  return storeNetWorthFrom(counts, movements, costs, end);
}
