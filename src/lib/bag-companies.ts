import sql from "@/lib/sql";
import { BAG_COMPANIES, bagCompanySlug, registerBagCompanies, type BagCompany } from "@/lib/products";

/**
 * PP bag companies added from the bot — "➕ Other" on a delivery (table
 * pp_bag_companies, migration 0046). Great Wall Packaging and Ethio-India are
 * written in products.ts; these are registered on top, cached for a minute per
 * instance like the store's GRV-added items.
 */

const CACHE_MS = 60_000;
let loadedAt = 0;
let loading: Promise<void> | null = null;

/** Read and register the added companies. Never throws: no table yet means none. */
export function loadBagCompanies(force = false): Promise<void> {
  if (!force && loading && Date.now() - loadedAt < CACHE_MS) return loading;
  loadedAt = Date.now();
  loading = (async () => {
    try {
      const rows = await sql<BagCompany[]>`select key, name from pp_bag_companies order by created_at, key`;
      registerBagCompanies(rows);
    } catch (e) {
      if ((e as { code?: string })?.code !== "42P01") console.error("pp_bag_companies could not be read:", e);
      loadedAt = 0;
    }
  })();
  return loading;
}

/**
 * The key for a company typed under "Other": an existing one when the name
 * matches (case and spacing aside), otherwise a new row.
 */
export async function addBagCompany(name: string): Promise<string> {
  const clean = String(name || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Type the PP bag company's name.");
  const key = bagCompanySlug(clean);
  if (!key) throw new Error("Type the PP bag company's name.");
  const known = BAG_COMPANIES.find((c) => c.key === key || c.name.toLowerCase() === clean.toLowerCase());
  if (known) return known.key;
  // Great Wall typed in full is still Great Wall.
  if (/^great-?wall/.test(key)) return "";
  await sql`insert into pp_bag_companies (key, name) values (${key}, ${clean}) on conflict (key) do nothing`;
  registerBagCompanies([{ key, name: clean }]);
  return key;
}
