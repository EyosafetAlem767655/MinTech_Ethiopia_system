/**
 * Credit sales: what is still owed, when it is due, and who has taken too much.
 *
 * A sale filed with an `invoice_credit` is money the company is owed on a
 * one-month term. This module holds the arithmetic for that — the due date, the
 * countdown, the status and the per-client alarm — and nothing else. Pure by
 * design (no `sql`, no network) so the API and the Finance panel compute exactly
 * the same figures from the same code, and both are testable on their own.
 *
 * Nothing here is stored in the database. Outstanding, status and days-left are
 * derived from the invoice's credit, the payments against it and today's date,
 * so deleting a mis-keyed payment corrects every one of them at once. A stored
 * status would disagree with its own payment history the moment that happened.
 */

/** The maximum term: a credit sale is due one calendar month after it was made. */
export const CREDIT_TERM_MONTHS = 1;

/** Inside this many days of the due date, a credit is "due soon" rather than merely open. */
export const DUE_SOON_DAYS = 7;

/**
 * Unpaid tonnage at which a client is flagged.
 *
 * The owner's rule: a client who keeps buying without settling is a growing
 * exposure, and 100 tonnes of unpaid stock is where it stops being ordinary
 * trade credit.
 */
export const ALARM_TONNES = 100;

/**
 * A credit counts as settled within a birr.
 *
 * The same one-birr tolerance the till reconciliation uses: a payment keyed as
 * 45,000 against a credit of 45,000.40 has settled the account, and leaving it
 * on the outstanding list forever because of forty cents helps nobody.
 */
export const SETTLED_TOLERANCE_ETB = 1;

export type CreditStatus = "settled" | "overdue" | "due_soon" | "open";

/** Midnight UTC of a date's calendar day — the shape the invoice dates are stored in. */
function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * When a credit sale falls due: the same day of the following month.
 *
 * Calendar months rather than 30 days, because "one month" is how the term was
 * agreed and how a client reads it. A month that has no such day — the 31st of
 * January, the 29th in a common year — falls back to that month's last day,
 * which is the ordinary convention and never overflows into the month after.
 */
export function creditDueDate(saleDate: Date | string): Date {
  const d = dayStart(new Date(saleDate));
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + CREDIT_TERM_MONTHS;
  const day = d.getUTCDate();
  // Day 0 of the NEXT month is the last day of the target month.
  const lastOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastOfTarget)));
}

/**
 * Whole days from today to the due date: positive means time left, negative
 * means overdue, zero means due today.
 *
 * Both sides are floored to their calendar day first, so a sale due today reads
 * as 0 all day rather than flipping to -1 at whatever hour it was filed.
 */
export function daysLeft(due: Date | string, now = new Date()): number {
  const dueDay = dayStart(new Date(due));
  // Today in EAT: the business day everyone on the ground is working to.
  const today = dayStart(new Date(now.getTime() + 3 * 3600_000));
  return Math.round((dueDay.getTime() - today.getTime()) / 86400000);
}

export interface CreditFigures {
  /** What the sale put on credit. */
  credit: number;
  /** Everything collected against it. */
  paid: number;
  outstanding: number;
  dueDate: Date;
  daysLeft: number;
  status: CreditStatus;
}

/** Everything derived about one credit sale. */
export function creditFigures(
  invoice: { date: Date | string; invoiceCredit: number; paid?: number },
  now = new Date()
): CreditFigures {
  const credit = Math.round((Number(invoice.invoiceCredit) || 0) * 100) / 100;
  const paid = Math.round((Number(invoice.paid) || 0) * 100) / 100;
  // Never negative: an overpayment settles the account, it does not make the
  // company owe the client money on this sale. The surplus is visible as
  // paid > credit on the row itself.
  const outstanding = Math.max(0, Math.round((credit - paid) * 100) / 100);
  const dueDate = creditDueDate(invoice.date);
  const left = daysLeft(dueDate, now);

  const status: CreditStatus =
    outstanding <= SETTLED_TOLERANCE_ETB ? "settled" : left < 0 ? "overdue" : left <= DUE_SOON_DAYS ? "due_soon" : "open";

  return { credit, paid, outstanding, dueDate, daysLeft: left, status };
}

export const STATUS_LABEL: Record<CreditStatus, string> = {
  settled: "Settled",
  overdue: "Overdue",
  due_soon: "Due soon",
  open: "Open",
};

/** How a countdown reads in words. */
export function daysLeftLabel(f: Pick<CreditFigures, "status" | "daysLeft">): string {
  if (f.status === "settled") return "—";
  const n = f.daysLeft;
  if (n === 0) return "due today";
  if (n > 0) return `${n} day${n === 1 ? "" : "s"} left`;
  return `${-n} day${n === -1 ? "" : "s"} over`;
}

export interface CreditRowLike {
  customer: string;
  /** Tonnes on this invoice. */
  qty: number;
  outstanding: number;
  status: CreditStatus;
  daysLeft: number;
}

export interface CustomerExposure {
  customer: string;
  /** Tonnes on invoices that still have credit outstanding. */
  unpaidTonnes: number;
  outstanding: number;
  invoices: number;
  /** Worst overdue on the account, in days. 0 when nothing is overdue. */
  worstOverdueDays: number;
  /** True once unpaid tonnage reaches the alarm threshold. */
  alarm: boolean;
}

/**
 * Exposure per client, worst first.
 *
 * Only invoices with credit STILL OUTSTANDING contribute. A sale that has been
 * paid for is not exposure, however big it was, and counting it would leave a
 * client permanently on alarm for business they settled months ago.
 */
export function customerExposure(rows: CreditRowLike[]): CustomerExposure[] {
  const byCustomer = new Map<string, CustomerExposure>();

  for (const r of rows) {
    if (r.status === "settled") continue;
    const key = String(r.customer || "").trim() || "—";
    const cur =
      byCustomer.get(key) ??
      ({ customer: key, unpaidTonnes: 0, outstanding: 0, invoices: 0, worstOverdueDays: 0, alarm: false } as CustomerExposure);
    cur.unpaidTonnes += Number(r.qty) || 0;
    cur.outstanding += Number(r.outstanding) || 0;
    cur.invoices += 1;
    if (r.daysLeft < 0) cur.worstOverdueDays = Math.max(cur.worstOverdueDays, -r.daysLeft);
    byCustomer.set(key, cur);
  }

  return [...byCustomer.values()]
    .map((c) => ({
      ...c,
      unpaidTonnes: Math.round(c.unpaidTonnes * 1000) / 1000,
      outstanding: Math.round(c.outstanding * 100) / 100,
      alarm: c.unpaidTonnes >= ALARM_TONNES,
    }))
    .sort((a, b) => b.unpaidTonnes - a.unpaidTonnes);
}

/** The clients over the threshold — what the alarm banner and the ticker show. */
export function alarmingCustomers(rows: CreditRowLike[]): CustomerExposure[] {
  return customerExposure(rows).filter((c) => c.alarm);
}
