import sql from "@/lib/sql";
import { STORE_GROUPS, STORE_ITEM_BY_KEY, type StoreItem } from "@/lib/store-items";
import { itemKey } from "@/lib/store-count-paste";

/**
 * What is on the shelf, worked out from the counts rather than stored.
 *
 * There is no running balance anywhere in this file, and that is deliberate.
 * A count is routinely partial — the bearings today, the electrics on Thursday
 * — so a balance kept by adding and subtracting would drift the first time a
 * block was skipped, and nothing on screen could say which figure to believe.
 * The current quantity of an item is simply the newest count that included it.
 *
 * The same rule gives the staleness marker for free: a group was last counted
 * when the newest count naming it was filed.
 */

/** How far back the readers look. A year of weekly counts is ~52 rows. */
const WINDOW = 400;

export interface CountRow {
  date: string;
  groups: string[];
  items: Record<string, number>;
  counted_by: string;
}

export interface ItemStatus {
  item: StoreItem;
  /** Null when this item has never been counted. */
  qty: number | null;
  /** The figure before that one, for the change column. */
  previous: number | null;
  countedAt: string | null;
  countedBy: string | null;
  /** How many counts in a row have reported the same figure. */
  unchangedFor: number;
}

export interface GroupStatus {
  group: string;
  label: string;
  block: string;
  countedAt: string | null;
  /** Days since, or null when it has never been counted. */
  daysSince: number | null;
  stale: boolean;
}

/** A group not counted within this many days is called out. */
export const STALE_DAYS = 7;

/** Newest first. Guarded: the table arrives in 0034. */
export async function recentCounts(): Promise<CountRow[]> {
  try {
    return await sql<CountRow[]>`
      select date, groups, items, counted_by
        from store_counts
       order by date desc, created_at desc
       limit ${WINDOW}
    `;
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") throw e;
    console.warn("store_counts is not migrated yet; the inventory reads as never counted");
    return [];
  }
}

const days = (from: string, now: Date) =>
  Math.floor((now.getTime() - new Date(from).getTime()) / 86_400_000);

/**
 * Every item with its latest figure, the one before it, and how long it has
 * been sitting still.
 *
 * `unchangedFor` is what answers the risk the pre-filled template carries: a
 * figure that comes back identical week after week is either a part nobody
 * touches or a line nobody recounts, and the two look the same until somebody
 * is shown the streak.
 */
export function itemStatuses(counts: CountRow[], now = new Date()): ItemStatus[] {
  return [...STORE_ITEM_BY_KEY.values()].map((item) => {
    const seen: { qty: number; at: string; by: string }[] = [];
    for (const c of counts) {
      const v = c.items?.[item.key];
      if (v === undefined || v === null) continue;
      seen.push({ qty: Number(v), at: new Date(c.date).toISOString(), by: c.counted_by });
    }
    if (seen.length === 0) {
      return { item, qty: null, previous: null, countedAt: null, countedBy: null, unchangedFor: 0 };
    }
    let unchanged = 1;
    while (unchanged < seen.length && seen[unchanged].qty === seen[0].qty) unchanged++;
    return {
      item,
      qty: seen[0].qty,
      previous: seen[1]?.qty ?? null,
      countedAt: seen[0].at,
      countedBy: seen[0].by,
      unchangedFor: unchanged,
    };
  });
}

/** When each group was last counted, and whether that is too long ago. */
export function groupStatuses(counts: CountRow[], now = new Date()): GroupStatus[] {
  return STORE_GROUPS.map((g) => {
    const hit = counts.find((c) => (c.groups ?? []).includes(g.key) || Object.keys(c.items ?? {}).some((k) => k.startsWith(`${g.key}:`)));
    const countedAt = hit ? new Date(hit.date).toISOString() : null;
    const daysSince = countedAt ? days(countedAt, now) : null;
    return {
      group: g.key,
      label: g.label,
      block: g.block,
      countedAt,
      daysSince,
      // Never counted is stale too: the whole point of the marker is to say
      // which shelves nobody has been to.
      stale: daysSince === null || daysSince > STALE_DAYS,
    };
  });
}

/**
 * The draft a new count starts from: every item at its last known figure.
 *
 * This is what pre-fills the paste blocks, so the storekeeper edits what moved
 * instead of retyping 132 lines. An item never counted is left OUT rather than
 * seeded with 0 — a zero nobody has ever verified would be indistinguishable
 * from a shelf that was checked and found empty.
 */
export async function seedStoreDraft(): Promise<Record<string, string | number>> {
  const counts = await recentCounts();
  const draft: Record<string, string | number> = {};
  for (const s of itemStatuses(counts)) {
    if (s.qty !== null) draft[itemKey(s.item.key)] = s.qty;
  }
  return draft;
}

/** Days since anything at all was counted, or null if nothing ever was. */
export function daysSinceAnyCount(counts: CountRow[], now = new Date()): number | null {
  const newest = counts[0];
  return newest ? days(new Date(newest.date).toISOString(), now) : null;
}
