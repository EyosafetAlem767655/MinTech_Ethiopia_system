import sql from "@/lib/sql";
import {
  BAG_SIZES,
  BAG_SIZE_LABEL,
  FINANCE_RAW_MATERIALS,
  PRODUCT_ORDER,
  bagSizeTotals,
  productLabel,
  rollUpMaterials,
  type BagCounts,
} from "@/lib/products";

/**
 * The monthly finance report: what the plant started the month with, what it
 * gained and lost, and what the remainder is worth.
 *
 * Two tables, because finished brands and raw materials behave differently. A
 * brand is produced and SOLD; a raw material is received and CONSUMED. Nothing
 * is shared between them except the shape of the arithmetic.
 *
 * Every figure is derived from a submission that already exists somewhere else —
 * this module only reads and arranges. The one judgement it makes is the
 * Dolomite roll-up, which lives in products.ts.
 */

/* ─────────────────────────────── month bounds ─────────────────────────────── */

/** `[start, end)` for a "YYYY-MM" label, in Ethiopian local time (UTC+3). */
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 3 * 3600_000);
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - 3 * 3600_000);
  return { start, end };
}

/** "YYYY-MM" for the month containing `d`, in EAT. */
export function monthLabel(d: Date = new Date()): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 7);
}

/** The month after `month`. The base balance for June is filed at the end of May. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * True when `now` is the day the base-balance reminder goes out: three days
 * before the month ends.
 *
 * A literal 29th was the original request, but February does not have one in
 * most years, and in a leap year the 29th is the last day — no lead time at all.
 * Counting back from the end gives the same three days' notice in every month.
 */
export function isBaseBalanceReminderDay(now: Date = new Date()): boolean {
  const eat = new Date(now.getTime() + 3 * 3600_000);
  const y = eat.getUTCFullYear();
  const m = eat.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return eat.getUTCDate() === daysInMonth - 3;
}

/* ───────────────────────────────── row shapes ─────────────────────────────── */

export interface ProductionFinanceRow {
  code: string;
  label: string;
  baseBalance: number;
  received: number;
  /** Share of the month's total production, as a percentage. */
  receivedPct: number;
  total: number;
  sold: number;
  /** Share of the month's total sales, as a percentage. */
  soldPct: number;
  revenue: number;
  stock: number;
  unitPrice: number;
  netWorth: number;
}

export interface RawMaterialFinanceRow {
  code: string;
  label: string;
  /** Tonnes for materials, pieces for bags — they never share a column total. */
  unit: "t" | "pcs";
  baseBalance: number;
  received: number;
  total: number;
  issue: number;
  stock: number;
  unitPrice: number;
  netWorth: number;
}

export interface FinanceReport {
  month: string;
  /** False when asset management has not filed the opening balance yet. */
  hasBaseBalance: boolean;
  /** False when finance has not filed the month's price list yet. */
  hasPrices: boolean;
  usdRate: number | null;
  production: ProductionFinanceRow[];
  rawMaterials: RawMaterialFinanceRow[];
  totals: {
    baseBalance: number;
    received: number;
    sold: number;
    revenue: number;
    stock: number;
    productionNetWorth: number;
    rawMaterialNetWorth: number;
    netWorth: number;
  };
}

const n = (v: unknown) => Number(v) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Sum a `{ key: number }` jsonb column across rows into one map. */
function sumMaps(rows: { m: Record<string, number> | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.m || {})) out[k] = (out[k] || 0) + n(v);
  }
  return out;
}

/* ────────────────────────────────── the report ────────────────────────────── */

export async function buildFinanceReport(month: string): Promise<FinanceReport> {
  const { start, end } = monthBounds(month);

  const [base, priceList, produced, delivered, received, bagsBought, issued] = await Promise.all([
    sql<{ products: Record<string, number>; raw_materials: Record<string, number>; bags: Record<string, number> }[]>`
      select products, raw_materials, bags from monthly_base_balances where month = ${month}
    `.catch(() => []),
    sql<{ prices: Record<string, number>; usd_rate: string | null }[]>`
      select prices, usd_rate from monthly_price_lists where month = ${month}
    `.catch(() => []),
    // Produced: the guided daily production report.
    sql<{ m: Record<string, number> }[]>`
      select products as m from production_reports where date >= ${start} and date < ${end}
    `.catch(() => []),
    // Sold: the delivery reports. sales_receipts.product_ty is free text with no
    // stated unit, so it cannot be summed per brand without inventing a matcher.
    sql<{ m: Record<string, number> }[]>`
      select products as m from delivery_reports where date >= ${start} and date < ${end}
    `.catch(() => []),
    sql<{ m: Record<string, number> }[]>`
      select materials as m from raw_material_receipts where date >= ${start} and date < ${end}
    `.catch(() => []),
    // Typed as BagCounts, not Record<string, number>: an asset-filed row nests a
    // colour map under each size, and pretending otherwise is what would let the
    // arithmetic below quietly produce NaN.
    sql<{ m: BagCounts }[]>`
      select bags as m from pp_bag_purchases where date >= ${start} and date < ${end}
    `.catch(() => []),
    sql<{ m: Record<string, number>; b: Record<string, number> }[]>`
      select materials as m, bags as b from material_issues where date >= ${start} and date < ${end}
    `.catch(() => []),
  ]);

  const baseRow = base[0];
  const prices = priceList[0]?.prices || {};
  const usdRate = priceList[0]?.usd_rate == null ? null : n(priceList[0].usd_rate);

  const producedMap = sumMaps(produced);
  const soldMap = sumMaps(delivered);
  const receivedMap = rollUpMaterials(sumMaps(received));
  // Bag purchases arrive in two shapes: asset management counts them by size AND
  // colour, finance files a receipt with no counts at all, and rows from before
  // the colour split carry a plain total per size. bagSizeTotals flattens all
  // three, so a nested map cannot silently read as NaN and lose a month of
  // deliveries. Colours are summed away here because the report has one line per
  // size — the breakdown is on the asset tab, where it was counted.
  const bagsBoughtMap: Record<string, number> = { kg25: 0, kg40: 0 };
  for (const row of bagsBought) {
    const totals = bagSizeTotals(row.m as BagCounts);
    for (const size of BAG_SIZES) bagsBoughtMap[size] += totals[size];
  }
  const issuedMaterials = rollUpMaterials(sumMaps(issued.map((r) => ({ m: r.m }))));
  const issuedBags = sumMaps(issued.map((r) => ({ m: r.b })));

  const totalProduced = Object.values(producedMap).reduce((a, b) => a + n(b), 0);
  const totalSold = Object.values(soldMap).reduce((a, b) => a + n(b), 0);

  /* ── Finished brands ── */
  const production: ProductionFinanceRow[] = PRODUCT_ORDER.map((code) => {
    const baseBalance = round3(n(baseRow?.products?.[code]));
    const rec = round3(n(producedMap[code]));
    const total = round3(baseBalance + rec);
    const sold = round3(n(soldMap[code]));
    const unitPrice = round2(n(prices[code]));
    const stock = round3(total - sold);
    return {
      code,
      label: productLabel(code),
      baseBalance,
      received: rec,
      receivedPct: pct(rec, totalProduced),
      total,
      sold,
      soldPct: pct(sold, totalSold),
      revenue: round2(sold * unitPrice),
      stock,
      unitPrice,
      netWorth: round2(stock * unitPrice),
    };
  });

  /* ── Raw materials, then the two bag sizes ── */
  const rawMaterials: RawMaterialFinanceRow[] = FINANCE_RAW_MATERIALS.map((code) => {
    const baseBalance = round3(n(baseRow?.raw_materials?.[code]));
    const rec = round3(n(receivedMap[code]));
    const total = round3(baseBalance + rec);
    const issue = round3(n(issuedMaterials[code]));
    const unitPrice = round2(n(prices[code]));
    const stock = round3(total - issue);
    return {
      code,
      label: code,
      unit: "t" as const,
      baseBalance,
      received: rec,
      total,
      issue,
      stock,
      unitPrice,
      netWorth: round2(stock * unitPrice),
    };
  });

  for (const size of BAG_SIZES) {
    // Bags are counted, not weighed, so they carry their own unit and never
    // contribute to a tonnage total.
    const baseBalance = Math.round(n(baseRow?.bags?.[size]));
    const rec = Math.round(n(bagsBoughtMap[size]));
    const total = baseBalance + rec;
    const issue = Math.round(n(issuedBags[size]));
    const unitPrice = round2(n(prices[size]));
    const stock = total - issue;
    rawMaterials.push({
      code: size,
      label: `${BAG_SIZE_LABEL[size]} PP bag`,
      unit: "pcs",
      baseBalance,
      received: rec,
      total,
      issue,
      stock,
      unitPrice,
      netWorth: round2(stock * unitPrice),
    });
  }

  const productionNetWorth = round2(production.reduce((a, r) => a + r.netWorth, 0));
  const rawMaterialNetWorth = round2(rawMaterials.reduce((a, r) => a + r.netWorth, 0));

  return {
    month,
    hasBaseBalance: Boolean(baseRow),
    hasPrices: priceList.length > 0,
    usdRate,
    production,
    rawMaterials,
    totals: {
      baseBalance: round3(production.reduce((a, r) => a + r.baseBalance, 0)),
      received: round3(totalProduced),
      sold: round3(totalSold),
      revenue: round2(production.reduce((a, r) => a + r.revenue, 0)),
      stock: round3(production.reduce((a, r) => a + r.stock, 0)),
      productionNetWorth,
      rawMaterialNetWorth,
      netWorth: round2(productionNetWorth + rawMaterialNetWorth),
    },
  };
}

/**
 * Every item a price is needed for, in the order the price-list flow asks for
 * them: the ten finished brands, then the three raw materials, then the bags.
 */
export function priceListItems(): { key: string; label: string; unit: string }[] {
  return [
    ...PRODUCT_ORDER.map((code) => ({ key: code, label: productLabel(code), unit: "ETB/ton" })),
    ...FINANCE_RAW_MATERIALS.map((code) => ({ key: code, label: code, unit: "ETB/ton" })),
    ...BAG_SIZES.map((size) => ({
      key: size,
      label: `${BAG_SIZE_LABEL[size]} PP bag`,
      unit: "ETB/piece",
    })),
  ];
}
