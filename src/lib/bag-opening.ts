import sql from "@/lib/sql";
import { isCompanyBagKey, type BagCounts } from "@/lib/products";

/**
 * Where each company's PP bag stock starts.
 *
 * Bags have been kept per company (Great Wall Packaging, Ethio-India) since
 * the count of 23 Oct 2026. In a month with no per-company opening balance
 * filed, the FIRST per-company count of the month is the opening: what was on
 * the floor that day. Company bags received, used or issued on or before that
 * day are already inside it, so only movements dated after it are added.
 *
 * Kinds recorded before companies (no "@" in the key) are untouched by this.
 */

export interface BagCompanyOpening {
  /** The day of the opening count, or null if the month has none. */
  from: Date | null;
  /** Company movements count only when dated after this. */
  after: Date;
  /** Ledger key → pieces, company kinds only. */
  values: Record<string, number>;
}

/** Does this flat ledger-key map hold any company's bags? */
export function hasCompanyBags(map: Record<string, unknown> | null | undefined): boolean {
  return Object.keys(map || {}).some(isCompanyBagKey);
}

/** Is a movement of `key` on `date` new since the opening? History always is. */
export function notBeforeOpening(key: string, date: Date | string, after: Date): boolean {
  return !isCompanyBagKey(key) || new Date(date).getTime() > after.getTime();
}

/**
 * The day company keeping began. A company-tagged count before it (from the
 * short-lived first attempt, seed 0013) is not an opening.
 */
export const BAG_COMPANIES_SINCE = new Date("2026-10-23T00:00:00Z");

export async function bagCompanyOpening(start: Date, end: Date): Promise<BagCompanyOpening> {
  const from = start.getTime() > BAG_COMPANIES_SINCE.getTime() ? start : BAG_COMPANIES_SINCE;
  const [row] = await sql<{ date: Date; bags: BagCounts }[]>`
    select date, bags
      from daily_ops_reports
     where date >= ${from} and date < ${end}
       and bags::text like '%@%'
     order by date asc
     limit 1
  `.catch(() => []);
  if (!row) return { from: null, after: new Date(0), values: {} };

  const values: Record<string, number> = {};
  for (const [size, inner] of Object.entries(row.bags || {})) {
    if (!inner || typeof inner !== "object") continue;
    for (const [colour, pieces] of Object.entries(inner)) {
      const key = `${size}:${colour}`;
      if (isCompanyBagKey(key)) values[key] = Number(pieces) || 0;
    }
  }
  return { from: new Date(row.date), after: new Date(row.date), values };
}
