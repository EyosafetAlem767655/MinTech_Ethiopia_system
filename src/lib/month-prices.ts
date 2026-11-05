import sql from "@/lib/sql";

/**
 * The unit prices a month runs on.
 *
 * Each item takes its newest price from the lists filed for this month or any
 * before it, so a month nobody priced runs on the last prices submitted rather
 * than valuing everything at zero. Per item, not per list: a list is often
 * partial (a 🧺 PP bag price update files bags alone), and a price missing from
 * one means "not given", unlike a stock figure, where a missing line is a zero.
 */
export interface MonthPrices {
  prices: Record<string, number>;
  usdRate: number | null;
  /** A list was filed for this very month. */
  filedThisMonth: boolean;
  /** The newest earlier month that supplied a price or the rate, if any did. */
  carriedFrom: string | null;
}

/** `month` is 'YYYY-MM'. */
export async function monthPrices(month: string): Promise<MonthPrices> {
  const rows = await sql<{ month: string; prices: Record<string, number> | null; usd_rate: string | null }[]>`
    select month, prices, usd_rate from monthly_price_lists
     where month <= ${month}
     order by month desc
  `;

  const prices: Record<string, number> = {};
  let usdRate: number | null = null;
  let carriedFrom: string | null = null;
  for (const r of rows) {
    const earlier = r.month !== month;
    let used = false;
    for (const [k, v] of Object.entries(r.prices || {})) {
      if (k in prices || !(Number(v) > 0)) continue;
      prices[k] = Number(v);
      used = true;
    }
    if (usdRate === null && Number(r.usd_rate) > 0) {
      usdRate = Number(r.usd_rate);
      used = true;
    }
    if (earlier && used && carriedFrom === null) carriedFrom = r.month;
  }

  return { prices, usdRate, filedThisMonth: rows[0]?.month === month, carriedFrom };
}
