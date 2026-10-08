import sql from "@/lib/sql";
import { STORE_GROUPS, STORE_ITEM_BY_KEY, type StoreItem } from "@/lib/store-items";

/**
 * What is on the shelf: the newest count, moved on by the vouchers since.
 *
 * The COUNT stays the anchor. A count is routinely partial — the bearings
 * today, the electrics on Thursday — so a balance kept by adding and
 * subtracting from the beginning of time would drift the first time a block
 * was skipped. Instead each item restarts from its own newest count, and only
 * the vouchers filed AFTER that count move it:
 *
 *     balance = last count + received on GRVs since − issued on SIVs since
 *
 * So a recount always resets the figure to what is physically there, and the
 * gap between the expected balance and the next count is exactly the shrinkage
 * nobody wrote down. `qty` (the counted figure) is kept beside `balance` (the
 * expected one) so both can be read.
 *
 * The staleness marker comes from the counts too: a group was last counted
 * when the newest count naming it was filed.
 */

/** How far back the readers look. A year of weekly counts is ~52 rows. */
const WINDOW = 400;

export interface CountRow {
  date: string;
  groups: string[];
  items: Record<string, number>;
  counted_by: string;
  /** Orders a count against a voucher filed on the same day. */
  created_at?: string;
}

/** One warehouse-list line on a voucher. */
export interface Movement {
  itemKey: string;
  direction: "in" | "out";
  qty: number;
  /** The voucher's date. */
  date: string;
  createdAt: string;
}

export interface ItemStatus {
  item: StoreItem;
  /** The last COUNTED figure. Null when this item has never been counted. */
  qty: number | null;
  /** Received on GRVs since that count (or ever, if never counted). */
  received: number;
  /** Issued on SIVs since that count (or ever, if never counted). */
  issued: number;
  /** What should be on the shelf: count + received − issued. */
  balance: number;
  /** The item's current cost, when one is known. */
  unitCost: number | null;
  /** balance × unitCost, or null with no cost. */
  value: number | null;
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
      select date, groups, items, counted_by, created_at
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
export function itemStatuses(
  counts: CountRow[],
  movements: Movement[] = [],
  costs: Map<string, { unitCost: number }> = new Map()
): ItemStatus[] {
  const byItem = new Map<string, Movement[]>();
  for (const m of movements) {
    const list = byItem.get(m.itemKey) ?? [];
    list.push(m);
    byItem.set(m.itemKey, list);
  }

  return [...STORE_ITEM_BY_KEY.values()].map((item) => {
    const seen: { qty: number; at: string; by: string; createdAt: string }[] = [];
    for (const c of counts) {
      const v = c.items?.[item.key];
      if (v === undefined || v === null) continue;
      const at = new Date(c.date).toISOString();
      seen.push({
        qty: Number(v),
        at,
        by: c.counted_by,
        createdAt: c.created_at ? new Date(c.created_at).toISOString() : at,
      });
    }

    // Only what moved after the newest count; everything, if never counted.
    const last = seen[0];
    const since = (byItem.get(item.key) ?? []).filter((m) => !last || movedAfter(m, last.at, last.createdAt));
    const received = round3(since.filter((m) => m.direction === "in").reduce((a, m) => a + m.qty, 0));
    const issued = round3(since.filter((m) => m.direction === "out").reduce((a, m) => a + m.qty, 0));
    const balance = round3((last?.qty ?? 0) + received - issued);
    const unitCost = costs.get(item.key)?.unitCost ?? null;
    const moved = {
      received,
      issued,
      balance,
      unitCost,
      value: unitCost ? Math.round(balance * unitCost * 100) / 100 : null,
    };

    if (!last) {
      return { item, qty: null, previous: null, countedAt: null, countedBy: null, unchangedFor: 0, ...moved };
    }
    let unchanged = 1;
    while (unchanged < seen.length && seen[unchanged].qty === seen[0].qty) unchanged++;
    return {
      item,
      qty: last.qty,
      previous: seen[1]?.qty ?? null,
      countedAt: last.at,
      countedBy: last.by,
      unchangedFor: unchanged,
      ...moved,
    };
  });
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Did this voucher move the item AFTER the count?
 *
 * A later day, plainly. The SAME day is decided by when each was filed: a
 * count taken in the morning and an issue made in the afternoon are both dated
 * today, and only the order they reached the system says the issue is not
 * already inside the counted figure.
 */
export function movedAfter(m: Movement, countDate: string, countCreatedAt: string): boolean {
  const md = new Date(m.date).toISOString().slice(0, 10);
  const cd = new Date(countDate).toISOString().slice(0, 10);
  if (md !== cd) return md > cd;
  return new Date(m.createdAt).getTime() > new Date(countCreatedAt).getTime();
}

/**
 * Every warehouse-list line ever put on a voucher, both directions. Guarded:
 * before 0037 there are no 'store' lines, and the inventory reads as counts only.
 */
export async function storeMovements(): Promise<Movement[]> {
  try {
    const rows = await sql<
      { item_key: string; direction: "in" | "out"; qty: string; date: string; created_at: string }[]
    >`
      select i.ledger_key as item_key, 'in' as direction, i.ledger_qty as qty, v.date, i.created_at
        from goods_receiving_items i
        join goods_receiving_vouchers v on v.id = i.grv_id
       where i.ledger_kind = 'store' and i.ledger_key is not null
      union all
      select i.ledger_key, 'out', i.ledger_qty, v.date, i.created_at
        from store_issue_items i
        join store_issue_vouchers v on v.id = i.siv_id
       where i.ledger_kind = 'store' and i.ledger_key is not null
    `;
    return rows.map((r) => ({
      itemKey: r.item_key,
      direction: r.direction,
      qty: Number(r.qty) || 0,
      date: new Date(r.date).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
    }));
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return [];
  }
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

/** Days since anything at all was counted, or null if nothing ever was. */
export function daysSinceAnyCount(counts: CountRow[], now = new Date()): number | null {
  const newest = counts[0];
  return newest ? days(new Date(newest.date).toISOString(), now) : null;
}
