import sql from "@/lib/sql";
import { creditFigures } from "@/lib/credit";
import { buildFinanceReport, monthLabel } from "@/lib/finance-report";

/**
 * The few Finance figures worth a glance — for the Brief card and the top of
 * the Finance tab.
 *
 * Both used to count tool-purchase batches and WHT holders. Nothing has filed a
 * purchase batch since the Goods Receiving Voucher replaced it, so the card
 * read 0 and 0 every day. What Finance actually watches is money owed and money
 * held: the credit book and the monthly report.
 *
 * Every figure here is computed by the same code the Finance tab uses
 * (`creditFigures`, `buildFinanceReport`), so the card and the tab cannot
 * disagree. A missing table reads as 0 rather than failing the Brief.
 */

export interface CreditTotals {
  /** ETB still owed across every open credit sale. */
  outstanding: number;
  /** ETB owed on sales already past their due date. */
  overdue: number;
  overdueSales: number;
  dueSoonSales: number;
  openSales: number;
}

const ZERO: CreditTotals = { outstanding: 0, overdue: 0, overdueSales: 0, dueSoonSales: 0, openSales: 0 };
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function creditTotals(now = new Date()): Promise<CreditTotals> {
  try {
    const rows = await sql<{ date: string; credit: string; paid: string }[]>`
      select i.date, i.invoice_credit as credit,
             coalesce((select sum(p.amount) from sales_credit_payments p where p.invoice_id = i.id), 0) as paid
        from sales_invoices i
       where i.invoice_credit > 0
    `;
    const out = { ...ZERO };
    for (const r of rows) {
      const f = creditFigures({ date: r.date, invoiceCredit: Number(r.credit) || 0, paid: Number(r.paid) || 0 }, now);
      if (f.status === "settled") continue;
      out.openSales++;
      out.outstanding += f.outstanding;
      if (f.status === "overdue") {
        out.overdue += f.outstanding;
        out.overdueSales++;
      }
      if (f.status === "due_soon") out.dueSoonSales++;
    }
    return { ...out, outstanding: r2(out.outstanding), overdue: r2(out.overdue) };
  } catch (e) {
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return ZERO;
  }
}

/** Cash invoiced in a window, off the sales report. */
export async function cashSales(start: Date, end: Date): Promise<number> {
  const [r] = await sql<{ cash: string }[]>`
    select coalesce(sum(invoice_cash), 0) as cash from sales_invoices where date >= ${start} and date < ${end}
  `.catch(() => [{ cash: "0" }]);
  return Number(r?.cash) || 0;
}

/** The current month's total stock net worth, as the monthly report shows it. */
export async function monthNetWorth(month = monthLabel()): Promise<number> {
  try {
    const report = await buildFinanceReport(month);
    return Number(report.totals.netWorth) || 0;
  } catch (e) {
    console.error("monthNetWorth failed:", e);
    return 0;
  }
}

/** Birr in millions, for a tile: 12,345,678 → 12.35. */
export const millions = (etb: number) => Math.round((etb / 1_000_000) * 100) / 100;
