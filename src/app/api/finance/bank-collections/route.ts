import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { BANKS } from "@/lib/banks";

export const dynamic = "force-dynamic";

/**
 * GET — cash in through each bank, month by month, read off the sales report.
 *
 * Every sale on the sales report already says how much was paid in cash and
 * which bank it was deposited in, so the per-bank figure is a sum of what is
 * already recorded — not a second sheet typed in once a month that could
 * disagree with it. (That sheet, 🏦 የወሩ የባንክ ገቢ, is retired; its old rows
 * stay in `bank_collections` and under Settings → Submissions.)
 *
 * Cash only. Credit collections (`sales_credit_payments`) record no bank, so
 * they cannot be placed in a bank column and are left out rather than guessed.
 *
 * GET ?month=YYYY-MM returns that month's cash sales one by one, so any figure
 * in the table can be traced back to the sales that make it up.
 */

const NO_BANK = "No bank recorded";
const MONTH = /^\d{4}-\d{2}$/;

/**
 * The month in EAT, like every other date here. A function, not a constant:
 * building the fragment at import time would open the database client while
 * Next collects page data at build time, where there is no database.
 */
const eatMonth = () => sql`to_char(date at time zone 'Africa/Addis_Ababa', 'YYYY-MM')`;

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") || "";

  try {
    if (MONTH.test(month)) {
      const sales = await sql<
        { date_label: string; customer: string; delivery_no: string | null; bank: string | null; cash: string }[]
      >`
        select date_label, customer, delivery_no, bank, invoice_cash as cash
          from sales_invoices
         where invoice_cash > 0 and ${eatMonth()} = ${month}
         order by date, created_at
      `;
      return NextResponse.json({
        month,
        sales: sales.map((s) => ({
          date: s.date_label,
          customer: s.customer,
          deliveryNo: s.delivery_no,
          bank: s.bank?.trim() || NO_BANK,
          cash: Number(s.cash) || 0,
        })),
      });
    }

    const rows = await sql<{ month: string; bank: string | null; cash: string; n: string }[]>`
      select ${eatMonth()} as month, nullif(trim(bank), '') as bank, sum(invoice_cash) as cash, count(*) as n
        from sales_invoices
       where invoice_cash > 0
         and date >= date_trunc('month', now() at time zone 'Africa/Addis_Ababa') - interval '11 months'
       group by 1, 2
    `;

    const byMonth = new Map<string, { banks: Record<string, number>; counts: Record<string, number> }>();
    for (const r of rows) {
      const m = byMonth.get(r.month) ?? { banks: {}, counts: {} };
      const bank = r.bank ?? NO_BANK;
      m.banks[bank] = (m.banks[bank] || 0) + (Number(r.cash) || 0);
      m.counts[bank] = (m.counts[bank] || 0) + (Number(r.n) || 0);
      byMonth.set(r.month, m);
    }

    const months = [...byMonth.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([m, v]) => ({
        month: m,
        banks: v.banks,
        counts: v.counts,
        total: Object.values(v.banks).reduce((a, b) => a + b, 0),
        sales: Object.values(v.counts).reduce((a, b) => a + b, 0),
      }));

    // The canonical list first, in its order; anything typed under "Other"
    // after it; the sales with no bank at all last, where they are noticed.
    const seen = new Set(months.flatMap((m) => Object.keys(m.banks)));
    const banks = [
      ...BANKS.filter((b) => seen.has(b)),
      ...[...seen].filter((b) => b !== NO_BANK && !(BANKS as readonly string[]).includes(b)).sort(),
      ...(seen.has(NO_BANK) ? [NO_BANK] : []),
    ];

    return NextResponse.json({ months, banks });
  } catch (e) {
    // sales_invoices arrives in 0027.
    if ((e as { code?: string })?.code !== "42P01") throw e;
    return NextResponse.json({ months: [], banks: [], unavailable: true });
  }
}
