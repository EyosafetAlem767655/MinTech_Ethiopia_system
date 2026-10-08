import {
  GROUP_BY_KEY,
  STORE_BLOCKS,
  itemsOfBlock,
  type StoreBlockKey,
  type StoreItem,
} from "@/lib/store-items";
import { templateName } from "@/lib/store-count-paste";

/**
 * The warehouse list on the two vouchers (GRV in, SIV out).
 *
 * Both vouchers used to be typed line by line — a description, a unit, a
 * quantity, up to eight times — so the same bearing arrived as "6210", "brg
 * 6210" and "bearing 6210 2RS", and nothing could add those up into a shelf
 * balance. Now the person ticks the departments, ticks the items from the same
 * list the store is counted against, and fills in one block with an amount for
 * every ticked item. Each line is saved against the item's permanent key, which
 * is what lets the inventory say what SHOULD be on the shelf between counts.
 *
 * Anything not on the list (raw material, a one-off purchase) still goes in as
 * a typed line, behind the "other" tick.
 *
 * Pure — no `sql` — so the flow table, the parser and the review card share it.
 */

/** The department tick-list. */
export const STORE_DEPTS_STEP = "stDepts";
/** The value of the "not on the list" tick. */
export const STORE_OTHER = "other";
/** The one fill-in block with an amount for every ticked item. */
export const STORE_QTY_STEP = "stQty";

/**
 * Step id of one department's item tick-list.
 *
 * No ":" in it: the tick callback is `pick:<flow>:<step>:<value>`, split on
 * colons, so a colon in the step id would cut the step name in half.
 */
export function storeItemsStep(block: StoreBlockKey): string {
  return `stItems_${block}`;
}

/** Draft keys for one ticked item: quantity, unit cost typed, current cost known. */
export const storeQtyKey = (itemKey: string) => `sq:${itemKey}`;
export const storeCostKey = (itemKey: string) => `sc:${itemKey}`;
export const storeCostHintKey = (itemKey: string) => `hc:${itemKey}`;

const tickedValues = (draft: Record<string, string | number>, stepId: string) =>
  String(draft[stepId] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

/** The departments ticked, in list order (never "other"). */
export function tickedBlocks(draft: Record<string, string | number>): StoreBlockKey[] {
  const chosen = tickedValues(draft, STORE_DEPTS_STEP);
  return STORE_BLOCKS.map((b) => b.key).filter((k) => chosen.includes(k));
}

/** Whether "not on the list" was ticked. */
export function wantsOtherItems(draft: Record<string, string | number>): boolean {
  return tickedValues(draft, STORE_DEPTS_STEP).includes(STORE_OTHER);
}

/**
 * The tick-list for one department.
 *
 * The VALUE is the item's position in its department, not its key: keys like
 * "elec2:Cable 4x16mm" would push the callback past Telegram's 64-byte limit.
 * The position only has to survive the few minutes the ticks live in a draft —
 * it is turned back into the permanent key before anything is saved.
 */
export function storeItemChoices(block: StoreBlockKey): { label: string; value: string }[] {
  return itemsOfBlock(block).map((item, i) => ({ label: itemLabel(item), value: String(i) }));
}

/** "BEARING 6210", "Oils Gas OIL (l)" — the group says what a bare "16A" is. */
export function itemLabel(item: StoreItem): string {
  const group = GROUP_BY_KEY.get(item.group)?.label ?? item.group;
  return `${group} ${templateName(item)}`;
}

/** Every ticked item, in list order, across the ticked departments. */
export function tickedStoreItems(draft: Record<string, string | number>): StoreItem[] {
  const out: StoreItem[] = [];
  for (const block of tickedBlocks(draft)) {
    const items = itemsOfBlock(block);
    const picks = new Set(tickedValues(draft, storeItemsStep(block)).map(Number));
    items.forEach((item, i) => {
      if (picks.has(i)) out.push(item);
    });
  }
  return out;
}

/**
 * Ticked items the block still has to ask about: no quantity yet, or — on the
 * GRV — no price at all, neither typed nor already known. A purchase line with
 * no price would drop out of the voucher total without anybody noticing.
 */
export function itemsAwaiting(draft: Record<string, string | number>, withCost: boolean): StoreItem[] {
  const blank = (k: string) => draft[k] === undefined || draft[k] === "";
  return tickedStoreItems(draft).filter(
    (item) =>
      blank(storeQtyKey(item.key)) ||
      (withCost && !(Number(draft[storeCostKey(item.key)]) > 0) && !(Number(draft[storeCostHintKey(item.key)]) > 0))
  );
}

const header = (label: string) => `--- ${label} ---`;

/**
 * The block for the amounts. Lists only the ticked items still waiting for an
 * answer, under their group headings, so a block sent back half filled is
 * re-sent with just what is missing.
 *
 * On the GRV each line also takes a unit cost, written after an "x". When the
 * item's current cost is known it is already filled in, so the common case is
 * typing one number per line.
 */
export function storeVoucherTemplate(draft: Record<string, string | number>, withCost: boolean): string {
  const lines: string[] = [];
  let group = "";
  for (const item of itemsAwaiting(draft, withCost)) {
    if (item.group !== group) {
      group = item.group;
      lines.push(header(GROUP_BY_KEY.get(group)?.label ?? group));
    }
    const hint = Number(draft[storeCostHintKey(item.key)]) || 0;
    // A quantity already given stays on the line, so a block re-sent for a
    // missing price does not make the person type the quantity twice.
    const given = draft[storeQtyKey(item.key)];
    const qtyText = given === undefined || given === "" ? "" : String(given);
    lines.push(`${templateName(item)} = ${qtyText}${withCost && hint > 0 ? ` x ${hint}` : withCost && qtyText ? " x " : ""}`);
  }
  return lines.join("\n");
}

/* ─────────────────────────────── Parsing ──────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.*#]/g, "");

function toNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/\((?:pcs|l|m|roll|pak)\)/gi, "")
    .replace(/\b(pcs|ltr|lt|l|m|roll|pak|birr|etb|br)\b/gi, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned || !/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/**
 * "4", "4 x 1500", "4x1500", "4 * 1500", "4 @ 1500". Returns null qty for a
 * blank — including a line where only the pre-filled cost is left ("x 1500").
 */
export function parseAmount(raw: string): { qty: number | null; cost: number | null; bad: boolean } {
  const text = raw.trim();
  if (!text) return { qty: null, cost: null, bad: false };
  const [left, right] = text.split(/\s*[x×*@]\s*/i);
  const qtyText = (left ?? "").trim();
  const costText = (right ?? "").trim();
  const qty = qtyText ? toNumber(qtyText) : null;
  const cost = costText ? toNumber(costText) : null;
  const bad = (qtyText !== "" && qty === null) || (costText !== "" && cost === null);
  return { qty, cost, bad };
}

export interface ParsedStoreVoucher {
  /** Draft keys → numbers: sq:<key> always, sc:<key> when a cost was typed. */
  values: Record<string, number>;
  /** Lines naming no ticked item. */
  unknown: string[];
  /** Lines whose amount was not a number. */
  invalid: string[];
}

/**
 * Read the filled-in block back.
 *
 * Only TICKED items are matched — a name from somewhere else on the list is
 * reported, not quietly added, because a line the person never ticked is far
 * more likely a typo for one they did. Group headings switch context exactly as
 * on the store count: "16A" is a breaker and a single-phase breaker, and only
 * the heading above it says which.
 */
export function parseStoreVoucherPaste(
  draft: Record<string, string | number>,
  text: string,
  withCost: boolean
): ParsedStoreVoucher {
  const ticked = tickedStoreItems(draft);
  const byGroup = new Map<string, Map<string, string>>();
  for (const item of ticked) {
    const names = byGroup.get(item.group) ?? new Map<string, string>();
    names.set(norm(item.name), item.key);
    names.set(norm(templateName(item)), item.key);
    names.set(norm(item.key), item.key);
    names.set(norm(itemLabel(item)), item.key);
    byGroup.set(item.group, names);
  }
  // Longest heading first, so "BREAKER single phase" is never read as "BREAKER".
  const headings = [...byGroup.keys()]
    .map((g) => ({ key: g, norm: norm(GROUP_BY_KEY.get(g)?.label ?? g) }))
    .sort((a, b) => b.norm.length - a.norm.length);

  const values: Record<string, number> = {};
  const unknown: string[] = [];
  const invalid: string[] = [];
  let group: string | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!/[=:]/.test(line)) {
      const n = norm(line);
      const hit = n ? headings.find((h) => n.includes(h.norm)) : undefined;
      if (hit) group = hit.key;
      continue;
    }
    const m = line.match(/^([^=:]+)[=:](.*)$/);
    if (!m) continue;
    const name = norm(m[1]);

    let key: string | undefined;
    if (group) key = byGroup.get(group)?.get(name);
    if (!key) {
      // Outside a heading, or the full "BEARING 6210" label typed under any
      // heading: accept a name that only one ticked item answers to.
      const hits = [...byGroup.values()].map((names) => names.get(name)).filter(Boolean) as string[];
      if (hits.length === 1) key = hits[0];
    }
    if (!key) {
      unknown.push(line);
      continue;
    }

    const amount = parseAmount(m[2]);
    if (amount.bad) {
      invalid.push(line);
      continue;
    }
    if (amount.qty === null) continue; // left blank — asked again
    values[storeQtyKey(key)] = amount.qty;
    if (withCost && amount.cost !== null) values[storeCostKey(key)] = amount.cost;
  }
  return { values, unknown, invalid };
}

/* ───────────────────────────── The saved lines ────────────────────────────── */

export interface StoreLine {
  item: StoreItem;
  quantity: number;
  /** The cost typed on the voucher, else the item's current cost, else null. */
  unitCost: number | null;
}

/** Ticked items with their amounts, ready for the review card and the save. */
export function storeLines(draft: Record<string, string | number>): StoreLine[] {
  return tickedStoreItems(draft).map((item) => {
    const typed = Number(draft[storeCostKey(item.key)]);
    const hint = Number(draft[storeCostHintKey(item.key)]);
    const unitCost = typed > 0 ? typed : hint > 0 ? hint : null;
    return { item, quantity: Number(draft[storeQtyKey(item.key)]) || 0, unitCost };
  });
}
