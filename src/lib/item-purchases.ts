import sql from "@/lib/sql";
import { allStoreItems, STORE_ITEM_BY_KEY, type StoreItem } from "@/lib/store-items";
import { itemLabel } from "@/lib/store-voucher";
import { templateName } from "@/lib/store-count-paste";
import { eatDateLabel } from "@/lib/dates";
import { purchaseAmounts, type PriceBasis } from "@/lib/purchase-price";

/**
 * Items finance bought (migration 0042, `item_purchases`).
 *
 * A record only: the store balance is moved by the GRV when the goods arrive,
 * never by this. What a purchase adds to the store is its PRICE — a matched
 * item's unit price is filed as its cost, dated the day it was bought.
 */

/* ────────────────────────── Which store item is it? ───────────────────────── */

// The same normalisation as the GRV matcher's exact pass (store-match.ts), kept
// here so the bot flow does not pull the AI client into asset-flows.
const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.,*#()/"']/g, "");

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 2)
  );

/**
 * The store item a typed name IS, or the nearest few it might be.
 *
 * No AI: this runs inside the webhook, which has to answer at once. Exact means
 * the name spells an item's name, label or key (case and punctuation ignored)
 * and only one item does. Otherwise the items sharing the most words with it,
 * best first — the person picks one, or says it is new.
 *
 * Call `loadCustomStoreItems()` first so GRV-added items are in the list.
 */
export function suggestStoreItems(name: string, n = 5): { exact: StoreItem | null; similar: StoreItem[] } {
  const items = allStoreItems();
  const typed = norm(name);
  if (!typed) return { exact: null, similar: [] };
  const hits = items.filter((it) =>
    [norm(it.name), norm(templateName(it)), norm(itemLabel(it)), norm(it.key)].includes(typed)
  );
  if (hits.length === 1) return { exact: hits[0], similar: [] };

  const want = words(name);
  if (want.size === 0) return { exact: null, similar: hits.slice(0, n) };
  const scored = items
    .map((it) => {
      const have = words(itemLabel(it));
      let common = 0;
      for (const w of want) if (have.has(w)) common++;
      return { it, score: common / Math.max(want.size, have.size) };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return { exact: null, similar: scored.slice(0, n).map((s) => s.it) };
}

/* ─────────────────────────────────── Save ─────────────────────────────────── */

export interface PurchaseInput {
  date: Date;
  itemName: string;
  /** A store item key, or null for a new item / one not on the list. */
  itemKey: string | null;
  isNew: boolean;
  qty: number;
  unit: string;
  basis: PriceBasis;
  /** The figure typed: the price of one (basis "unit") or the total paid ("total"). */
  figure: number;
  /** The purchase request this buys, when it came from one. It is marked bought. */
  requestId?: string | null;
  note?: string | null;
  source: "telegram" | "app";
}

/**
 * One purchase, in one transaction: the row, the request it settles marked
 * bought, and the matched item's price filed as its cost.
 *
 * The cost row is written on the transaction itself, not through
 * `recordCosts` — a second connection inside a transaction is what deadlocked
 * the GRV save when the pool is one connection wide.
 */
export async function savePurchase(input: PurchaseInput, reportedBy: string): Promise<{ id: string }> {
  const itemName = String(input.itemName || "").trim();
  if (!itemName) throw new Error("Name the item that was bought.");
  const qty = Number(input.qty) || 0;
  if (!(qty > 0)) throw new Error("The quantity has to be more than zero.");
  const figure = Number(input.figure) || 0;
  if (!(figure > 0)) throw new Error(input.basis === "unit" ? "Give the price of one." : "Give the total paid.");
  const itemKey = input.itemKey && STORE_ITEM_BY_KEY.has(input.itemKey) ? input.itemKey : null;
  const { unitPrice, total } = purchaseAmounts(qty, input.basis, figure);
  const dateLabel = eatDateLabel(input.date);

  return sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      insert into item_purchases
        (date, date_label, item_name, item_key, is_new, qty, unit, unit_price, total, price_basis,
         request_id, note, reported_by, source)
      values (${input.date}, ${dateLabel}, ${itemName}, ${itemKey}, ${!itemKey && input.isNew}, ${qty},
              ${String(input.unit || "pcs")}, ${unitPrice}, ${total}, ${input.basis},
              ${input.requestId || null}, ${String(input.note || "").trim() || null}, ${reportedBy}, ${input.source})
      returning id`;
    if (input.requestId) {
      await tx`
        update purchase_requests
           set status = 'bought', decided_by = ${reportedBy}, decided_at = now()
         where id = ${input.requestId}`;
    }
    if (itemKey && unitPrice > 0) {
      await tx`
        insert into store_item_costs (item_key, unit_cost, effective_from, source, ref, recorded_by)
        values (${itemKey}, ${unitPrice}, ${dateLabel}::date, 'purchase', ${null}, ${reportedBy})`;
    }
    return { id: row.id };
  });
}

/* ─────────────────────────────────── Read ─────────────────────────────────── */

export interface PurchaseRow {
  id: string;
  date: string;
  itemName: string;
  itemKey: string | null;
  itemLabel: string | null;
  isNew: boolean;
  qty: number;
  unit: string;
  unitPrice: number | null;
  total: number | null;
  basis: PriceBasis | null;
  requestId: string | null;
  requestTitle: string | null;
  note: string | null;
  reportedBy: string;
  createdAt: string;
}

/** The newest purchases, with the request each one settled. Empty before 0042. */
export async function listPurchases(): Promise<{ rows: PurchaseRow[]; unavailable: boolean }> {
  try {
    const rows = await sql<
      {
        id: string;
        date: Date;
        item_name: string;
        item_key: string | null;
        is_new: boolean;
        qty: string;
        unit: string;
        unit_price: string | null;
        total: string | null;
        price_basis: PriceBasis | null;
        request_id: string | null;
        request_title: string | null;
        note: string | null;
        reported_by: string;
        created_at: Date;
      }[]
    >`
      select p.id, p.date, p.item_name, p.item_key, p.is_new, p.qty, p.unit, p.unit_price, p.total,
             p.price_basis, p.request_id, r.title as request_title, p.note, p.reported_by, p.created_at
        from item_purchases p
        left join purchase_requests r on r.id = p.request_id
       order by p.date desc, p.created_at desc
       limit 300`;
    return {
      unavailable: false,
      rows: rows.map((r) => {
        const item = r.item_key ? STORE_ITEM_BY_KEY.get(r.item_key) : undefined;
        return {
          id: r.id,
          date: new Date(r.date).toISOString(),
          itemName: r.item_name,
          itemKey: r.item_key,
          itemLabel: item ? itemLabel(item) : null,
          isNew: r.is_new,
          qty: Number(r.qty) || 0,
          unit: r.unit,
          unitPrice: r.unit_price == null ? null : Number(r.unit_price),
          total: r.total == null ? null : Number(r.total),
          basis: r.price_basis,
          requestId: r.request_id,
          requestTitle: r.request_title,
          note: r.note,
          reportedBy: r.reported_by,
          createdAt: new Date(r.created_at).toISOString(),
        };
      }),
    };
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return { rows: [], unavailable: true };
  }
}
