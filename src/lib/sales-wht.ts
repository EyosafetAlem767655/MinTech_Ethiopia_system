/**
 * Withholding tax on a sale (owner, 23 Nov 2026).
 *
 * A buyer with a TIN withholds 3% of the price BEFORE VAT on a purchase of
 * 20,000 birr or more (before VAT). The invoice is typed after VAT, so:
 *
 *   before VAT = invoice / 1.15,  WHT = 3% of that,  net = invoice − WHT
 *
 * 115,000 after VAT → 100,000 before → WHT 3,000 → 112,000 received.
 *
 * The same rule as apply_sales_wht() in migration 0049, which applies it to
 * sales already on file; keep the two in step.
 */

export const WHT_RATE = 0.03;
export const VAT_RATE = 0.15;
/** Before VAT, birr. */
export const WHT_THRESHOLD = 20_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const hasTin = (tin: string | null | undefined) => /^\d{10}$/.test(String(tin ?? "").trim());

/** True when the buyer withholds on this sale. */
export function whtApplies(cash: number, credit: number, tin: string | null | undefined): boolean {
  return hasTin(tin) && (cash + credit) / (1 + VAT_RATE) >= WHT_THRESHOLD;
}

export interface SaleWht {
  grossCash: number;
  grossCredit: number;
  wht: number;
  /** What every report adds up: the invoice less the WHT. */
  netCash: number;
  netCredit: number;
}

/** The invoice (after VAT, as typed) split into gross, WHT and net, cash and credit apart. */
export function salesWht(cash: number, credit: number, tin: string | null | undefined): SaleWht {
  const grossCash = round2(cash);
  const grossCredit = round2(credit);
  if (!whtApplies(grossCash, grossCredit, tin)) {
    return { grossCash, grossCredit, wht: 0, netCash: grossCash, netCredit: grossCredit };
  }
  const total = grossCash + grossCredit;
  const wht = round2((WHT_RATE * total) / (1 + VAT_RATE));
  const fromCash = round2((wht * grossCash) / total);
  return {
    grossCash,
    grossCredit,
    wht,
    netCash: round2(grossCash - fromCash),
    netCredit: round2(grossCredit - (wht - fromCash)),
  };
}
