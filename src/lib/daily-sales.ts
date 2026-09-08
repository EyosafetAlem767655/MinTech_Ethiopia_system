/**
 * The day's Payment Summary — the whole sales report, in one photograph.
 *
 * It used to be one report per transaction, repeated all day. This is the till's
 * own end-of-day summary instead: five payment methods, each with an amount
 * taken and an amount refunded.
 *
 * Pure by design — no `sql`, no network — so the arithmetic and the parser are
 * testable on their own.
 */

/** The five methods, in the order the printout lists them. */
export const PAYMENT_METHODS = ["cash", "cheque", "card", "credit", "voucher"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "CASH",
  cheque: "CHEQUE",
  card: "CARD",
  credit: "CREDIT",
  voucher: "VAUCHER",
};

/** Draft keys, matching the step ids in asset-flows.ts. */
export function paymentKey(m: PaymentMethod): string {
  return `pay:${m}`;
}
export function refundKey(m: PaymentMethod): string {
  return `refund:${m}`;
}

export interface DailySalesTotals {
  totalPayment: number;
  totalRefund: number;
  /** What actually came in: payments less refunds. */
  netTotal: number;
}

/** Money as stored: two decimals, no floating-point dust. */
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Read a money figure off the printout.
 *
 * The summary prints `*1,451,875.00` — a leading asterisk and thousands
 * separators. Both are stripped, and anything unreadable is 0 rather than NaN,
 * because a NaN reaching the totals would poison every figure derived from them.
 */
export function parseMoney(raw: unknown): number {
  const cleaned = String(raw ?? "").replace(/[^0-9.\-]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return isFinite(n) ? round2(n) : 0;
}

/**
 * The totals, computed from the ten numbers.
 *
 * Never copied from the printed total. Comparing a printed total against itself
 * can detect nothing, and a till roll whose own rows do not add up to its own
 * footer is exactly the thing worth catching.
 */
export function computeTotals(draft: Record<string, string | number>): DailySalesTotals {
  let totalPayment = 0;
  let totalRefund = 0;
  for (const m of PAYMENT_METHODS) {
    totalPayment += Number(draft[paymentKey(m)]) || 0;
    totalRefund += Number(draft[refundKey(m)]) || 0;
  }
  totalPayment = round2(totalPayment);
  totalRefund = round2(totalRefund);
  return { totalPayment, totalRefund, netTotal: round2(totalPayment - totalRefund) };
}

/**
 * Whether the printed total disagrees with the rows above it.
 *
 * A one-birr tolerance, because tills round. Anything larger is reported on the
 * review card and never silently overwritten in either direction.
 */
export function printedMismatch(
  draft: Record<string, string | number>
): { printed: number; computed: number } | null {
  const printed = Number(draft.printedTotal) || 0;
  if (!printed) return null;
  const { totalPayment } = computeTotals(draft);
  if (Math.abs(printed - totalPayment) <= 1) return null;
  return { printed, computed: totalPayment };
}

/** The row as it is written, ready to hand to the insert. */
export function summaryColumns(draft: Record<string, string | number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of PAYMENT_METHODS) {
    out[`${m}_payment`] = round2(Number(draft[paymentKey(m)]) || 0);
    out[`${m}_refund`] = round2(Number(draft[refundKey(m)]) || 0);
  }
  const t = computeTotals(draft);
  out.total_payment = t.totalPayment;
  out.total_refund = t.totalRefund;
  out.net_total = t.netTotal;
  return out;
}
