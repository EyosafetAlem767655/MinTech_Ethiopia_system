/**
 * How a purchase is priced — pure, so the web form and the bot share one rule.
 *
 * Bought by the piece, the price of ONE is what the receipt shows and the total
 * is qty × price. Bought by the pak (or by the litre, kilo, roll…) the receipt
 * shows what was PAID, and the price of one unit is total ÷ qty. Both figures
 * are kept; `basis` says which one was typed.
 */

export type PriceBasis = "unit" | "total";

/** The units a purchase is asked in; the matched item's own unit is added when it is neither. */
export const PURCHASE_UNITS_BASE = ["pcs", "pak"] as const;

export function priceBasisFor(unit: unknown): PriceBasis {
  return String(unit || "pcs").trim().toLowerCase() === "pcs" ? "unit" : "total";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The unit price and the total, from the one figure that was typed. */
export function purchaseAmounts(qty: number, basis: PriceBasis, figure: number): { unitPrice: number; total: number } {
  const q = Number(qty) || 0;
  const f = Number(figure) || 0;
  if (basis === "unit") return { unitPrice: r2(f), total: r2(q * f) };
  return { unitPrice: q > 0 ? r2(f / q) : 0, total: r2(f) };
}
