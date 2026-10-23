import { randomBytes } from "node:crypto";
import sql from "@/lib/sql";
import { ADDED_GROUP, GROUP_BY_KEY, registerCustomItems, type StoreItem, type StoreUnit } from "@/lib/store-items";

/**
 * The store items a GRV added (store_custom_items, migration 0039).
 *
 * The written list (store-items.ts) is code; these are rows. Every reader of the
 * list gets them through `registerCustomItems`, which this module calls after
 * reading the table — cached for a minute per instance, because the webhook
 * asks on every update and the table changes only when a GRV is saved.
 */

const UNITS: readonly StoreUnit[] = ["pcs", "l", "m", "roll", "pak", "kg", "set", "bottle", "drum", "tin", "berga", "pad", "ream"];

/** A unit as the list spells it; anything unknown counts in pieces. */
export function storeUnit(raw: unknown): StoreUnit {
  const u = String(raw || "").trim().toLowerCase();
  if ((UNITS as readonly string[]).includes(u)) return u as StoreUnit;
  if (/^(lt|ltr|litre|liter|litres|liters)$/.test(u)) return "l";
  if (/^(mtr|meter|metre|mat)$/.test(u)) return "m";
  if (/^(pkt|packet|pack)$/.test(u)) return "pak";
  if (/^(pads?)$/.test(u)) return "pad";
  if (/^(reams?|rem|rems)$/.test(u)) return "ream";
  if (/^(pes|pce|pces|piece|pieces)$/.test(u)) return "pcs";
  return "pcs";
}

const CACHE_MS = 60_000;
let loadedAt = 0;
let loading: Promise<StoreItem[]> | null = null;

/** Read and register the GRV-added items. Never throws: no table yet means none. */
export function loadCustomStoreItems(force = false): Promise<StoreItem[]> {
  if (!force && loading && Date.now() - loadedAt < CACHE_MS) return loading;
  loadedAt = Date.now();
  loading = (async () => {
    try {
      const rows = await sql<{ key: string; group_key: string; name: string; description: string | null; unit: string }[]>`
        select key, group_key, name, description, unit from store_custom_items order by created_at, key
      `;
      const items: StoreItem[] = rows.map((r) => ({
        key: r.key,
        group: r.group_key,
        name: r.description ? `${r.name} — ${r.description}` : r.name,
        unit: storeUnit(r.unit),
        custom: true,
        description: r.description ?? undefined,
      }));
      registerCustomItems(items);
      return items;
    } catch (e) {
      if ((e as { code?: string })?.code !== "42P01") console.error("store_custom_items could not be read:", e);
      loadedAt = 0; // try again next time
      return [];
    }
  })();
  return loading;
}

/** "x:ball-bearing-6210-3fa1" — permanent, like every written key. */
function newKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "item";
  return `x:${slug}-${randomBytes(2).toString("hex")}`;
}

export interface NewStoreItem {
  name: string;
  description: string;
  unit: string;
  group: string;
}

/**
 * Add items to the store list. Returns their new keys, in order, and a
 * `register` to call once they are committed — so an instance never shows an
 * item whose voucher rolled back.
 *
 * `client` is the transaction the voucher is saved in: the items, the voucher
 * and its lines are created together or not at all.
 */
export async function createCustomItems(
  items: NewStoreItem[],
  ref: string | null,
  by: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any = sql
): Promise<{ keys: string[]; register: () => void }> {
  if (items.length === 0) return { keys: [], register: () => {} };
  const rows = items.map((it) => ({
    key: newKey(it.name),
    group_key: GROUP_BY_KEY.has(it.group) ? it.group : ADDED_GROUP,
    name: it.name.trim().slice(0, 200),
    description: it.description.trim().slice(0, 300) || null,
    unit: storeUnit(it.unit),
    created_from: ref,
    created_by: by,
  }));
  await client`insert into store_custom_items ${client(rows)}`;
  const register = () =>
    registerCustomItems(
      rows.map((r) => ({
        key: r.key,
        group: r.group_key,
        name: r.description ? `${r.name} — ${r.description}` : r.name,
        unit: r.unit,
        custom: true,
        description: r.description ?? undefined,
      }))
    );
  return { keys: rows.map((r) => r.key), register };
}
