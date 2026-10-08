import sql from "@/lib/sql";

/**
 * What one warehouse item costs (migration 0037, `store_item_costs`).
 *
 * A history, never a single overwritten figure. Every price a GRV paid is a
 * row dated with the voucher, and every correction made on the web is a row
 * dated the 1st of the month it was made for. "The cost" of an item is then
 * always a question with a date in it — what did it cost ON the day this
 * voucher moved it — and a price entered today can never quietly revalue an
 * issue that happened in July.
 */

export interface ItemCost {
  unitCost: number;
  effectiveFrom: string;
  source: string;
  /** The GRV number a purchase price came from, when there was one. */
  ref: string | null;
}

const missingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";

/**
 * The cost in effect on `asOf` for each item: the newest row dated on or
 * before it. An item first priced AFTER that day falls back to its earliest
 * price — the nearest figure there is — rather than reading as free.
 *
 * Without `keys`, every priced item. Empty when the table is not there yet.
 */
export async function costsAt(asOf: Date, keys?: string[]): Promise<Map<string, ItemCost>> {
  const out = new Map<string, ItemCost>();
  if (keys && keys.length === 0) return out;
  const day = asOf.toISOString().slice(0, 10);
  try {
    const rows = await sql<
      { item_key: string; unit_cost: string; effective_from: string; source: string; ref: string | null }[]
    >`
      select distinct on (item_key) item_key, unit_cost, effective_from::text as effective_from, source, ref
        from store_item_costs
       where ${keys ? sql`item_key = any(${keys})` : sql`true`}
       order by item_key,
                (effective_from > ${day}::date),
                case when effective_from <= ${day}::date then effective_from end desc nulls last,
                effective_from asc,
                created_at desc
    `;
    for (const r of rows) {
      out.set(r.item_key, {
        unitCost: Number(r.unit_cost) || 0,
        effectiveFrom: r.effective_from,
        source: r.source,
        ref: r.ref,
      });
    }
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
  return out;
}

export interface CostEntry {
  itemKey: string;
  unitCost: number;
  /** YYYY-MM-DD. */
  effectiveFrom: string;
  source: "grv" | "web";
  ref?: string | null;
  recordedBy: string;
}

/** Record prices. Zero and negative figures are not prices and are dropped. */
export async function recordCosts(entries: CostEntry[]): Promise<number> {
  const rows = entries
    .filter((e) => Number.isFinite(e.unitCost) && e.unitCost > 0)
    .map((e) => ({
      item_key: e.itemKey,
      unit_cost: Math.round(e.unitCost * 100) / 100,
      effective_from: e.effectiveFrom,
      source: e.source,
      ref: e.ref ?? null,
      recorded_by: e.recordedBy,
    }));
  if (rows.length === 0) return 0;
  await sql`insert into store_item_costs ${sql(rows)}`;
  return rows.length;
}
