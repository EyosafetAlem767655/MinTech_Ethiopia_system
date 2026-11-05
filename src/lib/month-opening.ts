import sql from "@/lib/sql";
import { bagCompanyOpening, hasCompanyBags, type BagCompanyOpening } from "@/lib/bag-opening";
import type { BagCounts } from "@/lib/products";

/**
 * What finished products and PP bags a month OPENS with.
 *
 * A beginning balance filed for the month (monthly_base_balances) is used as
 * filed. Without one, the opening is whatever was last submitted before the
 * 1st: the newest daily row whose stock (or bag) section is filled in, or an
 * earlier month's filed balance if that is newer, taken exactly as submitted.
 * The owner's rule: "just pass on the data". It is not moved on by later
 * movements, and a counted figure is not preferred over a typed one. A month
 * nobody filed for used to open at zero on every line.
 *
 * Taken a whole row at a time, never value by value: a day's save drops zeros,
 * so a product missing from the newest row WAS zero that day, and reaching
 * back to an older row for it would revive stock that had gone.
 *
 * Raw material has its own, older rule (raw-material-opening.ts) and is not
 * handled here.
 */

export interface MonthOpening {
  /** Tonnes per product code. */
  products: Record<string, number>;
  /** Pieces per bag ledger key ("kg25:Yellow", "kg25:Yellow@GWP", …). */
  bags: Record<string, number>;
  productsSource: "submitted" | "carried" | "none";
  bagsSource: "submitted" | "carried" | "none";
  /** The day or month the carried figures were submitted for, if carried. */
  productsFrom: string | null;
  bagsFrom: string | null;
  /**
   * The per-company bag bootstrap (bag-opening.ts): the first per-company count
   * of the month standing in as its opening. Only used when the opening itself
   * holds no company bags, which is October 2026, the month companies began;
   * from then on the carried count is the opening and the whole month moves it.
   */
  bagCompany: BagCompanyOpening;
}

const n = (v: unknown) => Number(v) || 0;
const filled = (m: Record<string, unknown> | null | undefined) => Object.keys(m || {}).length > 0;

/** { kg25: { Yellow: 5 } } → { "kg25:Yellow": 5 }. A size with no colour map is skipped. */
function flattenBags(bags: BagCounts | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [size, inner] of Object.entries(bags || {})) {
    if (!inner || typeof inner !== "object") continue;
    for (const [colour, pieces] of Object.entries(inner)) out[`${size}:${colour}`] = n(pieces);
  }
  return out;
}

/** Was this daily row submitted on or after the 1st of `month`, which a filed balance opens? */
function newerThanMonth(date: Date | undefined, month: string): boolean {
  if (!date) return false;
  const [y, m] = month.split("-").map(Number);
  return new Date(date).getTime() >= Date.UTC(y, m - 1, 1) - 3 * 3_600_000;
}

/** `start`/`end` are the month's bounds (finance-report.ts `monthBounds`). */
export async function monthOpening(month: string, start: Date, end: Date): Promise<MonthOpening> {
  const [filedRows, earlierRows, stockRows, bagRows] = await Promise.all([
    sql<{ products: Record<string, number> | null; bags: Record<string, number> | null }[]>`
      select products, bags from monthly_base_balances where month = ${month}
    `.catch(() => []),
    sql<{ month: string; products: Record<string, number> | null; bags: Record<string, number> | null }[]>`
      select month, products, bags from monthly_base_balances where month < ${month} order by month desc
    `.catch(() => []),
    sql<{ date_label: string; date: Date; stock: Record<string, number> }[]>`
      select date_label, date, stock from daily_ops_reports
       where date < ${start} and stock is not null and stock::text <> '{}'
       order by date desc limit 1
    `.catch(() => []),
    sql<{ date_label: string; date: Date; bags: BagCounts }[]>`
      select date_label, date, bags from daily_ops_reports
       where date < ${start} and bags is not null and bags::text <> '{}'
       order by date desc limit 1
    `.catch(() => []),
  ]);
  const filed = filedRows[0];
  const earlierProducts = earlierRows.find((r) => filled(r.products));
  const earlierBags = earlierRows.find((r) => filled(r.bags));

  let products: Record<string, number> = {};
  let productsSource: MonthOpening["productsSource"] = "none";
  let productsFrom: string | null = null;
  if (filed && filled(filed.products)) {
    products = filed.products as Record<string, number>;
    productsSource = "submitted";
  } else if (earlierProducts && !newerThanMonth(stockRows[0]?.date, earlierProducts.month)) {
    products = earlierProducts.products as Record<string, number>;
    productsSource = "carried";
    productsFrom = earlierProducts.month;
  } else if (stockRows[0]) {
    for (const [k, v] of Object.entries(stockRows[0].stock || {})) products[k] = n(v);
    productsSource = "carried";
    productsFrom = stockRows[0].date_label;
  }

  let bags: Record<string, number> = {};
  let bagsSource: MonthOpening["bagsSource"] = "none";
  let bagsFrom: string | null = null;
  if (filed && filled(filed.bags)) {
    bags = filed.bags as Record<string, number>;
    bagsSource = "submitted";
  } else if (earlierBags && !newerThanMonth(bagRows[0]?.date, earlierBags.month)) {
    bags = earlierBags.bags as Record<string, number>;
    bagsSource = "carried";
    bagsFrom = earlierBags.month;
  } else if (bagRows[0]) {
    bags = flattenBags(bagRows[0].bags);
    bagsSource = "carried";
    bagsFrom = bagRows[0].date_label;
  }

  const bagCompany = hasCompanyBags(bags)
    ? { from: null, after: new Date(0), values: {} }
    : await bagCompanyOpening(start, end);

  return { products, bags, productsSource, bagsSource, productsFrom, bagsFrom, bagCompany };
}
