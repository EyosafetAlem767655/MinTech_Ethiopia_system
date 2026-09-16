import sql from "@/lib/sql";
import { PRODUCT_ORDER, orderProducts } from "@/lib/products";
import { rangeWindow, type RangeKey } from "@/lib/ranges";

/**
 * What the sales rows say when read together: who buys, what sells, how much
 * of it is cash, and where the money lands.
 *
 * Everything here is a GROUP BY over `sales_invoices` for one rolling window —
 * the same four windows the department reports use (30 days, 90 days, 6 months,
 * a year), so a figure on this tab means the same thing as the one on the brief.
 * Tonnes per brand come out of the `products` jsonb with `jsonb_each_text`, the
 * way the production series already reads its maps; there is no per-brand table
 * to keep in step.
 *
 * Server only — this imports the Postgres client.
 */

const EAT = "Africa/Addis_Ababa";

/** The windows this tab offers. A subset of RANGES on purpose: a day or a week
 *  of sales is a list, not a pattern. */
export const SALES_ANALYTICS_RANGES: RangeKey[] = ["monthly", "d90", "d180", "yearly"];

export interface CustomerStat {
  customer: string;
  etb: number;
  cashEtb: number;
  creditEtb: number;
  tons: number;
  sales: number;
}

export interface ProductStat {
  code: string;
  tons: number;
  /** Share of all tonnes in the window, 0-100. */
  share: number;
  sales: number;
}

export interface BankStat {
  bank: string;
  etb: number;
  sales: number;
}

export interface CashCreditPoint {
  date: string;
  cash: number;
  credit: number;
}

export interface SalesAnalytics {
  range: RangeKey;
  window: { start: string; end: string; bucket: "day" | "week" | "month" };
  totals: { sales: number; etb: number; cashEtb: number; creditEtb: number; tons: number; customers: number };
  customers: CustomerStat[];
  products: ProductStat[];
  cashVsCredit: CashCreditPoint[];
  banks: BankStat[];
}

const n = (v: unknown) => Number(v) || 0;

export async function salesAnalytics(range: RangeKey, now = new Date()): Promise<SalesAnalytics> {
  const { start, end, bucket } = rangeWindow(range, now);
  const step = bucket === "day" ? "1 day" : bucket === "week" ? "1 week" : "1 month";

  const empty: SalesAnalytics = {
    range,
    window: { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), bucket },
    totals: { sales: 0, etb: 0, cashEtb: 0, creditEtb: 0, tons: 0, customers: 0 },
    customers: [],
    products: [],
    cashVsCredit: [],
    banks: [],
  };

  // One round trip per question rather than one statement: a shape mismatch in
  // any single query then costs that chart, never the tab. The 42P01 guard is
  // the usual one — the table arrives in 0027.
  const guard = <T>(p: Promise<T[]>): Promise<T[]> =>
    p.catch((e) => {
      if ((e as { code?: string })?.code !== "42P01") throw e;
      return [];
    });

  const [totals, customers, products, series, banks] = await Promise.all([
    guard(
      sql<{ sales: string; cash: string; credit: string; tons: string; customers: string }[]>`
        select count(*) as sales,
               coalesce(sum(invoice_cash), 0)   as cash,
               coalesce(sum(invoice_credit), 0) as credit,
               coalesce(sum(qty), 0)            as tons,
               count(distinct lower(trim(customer))) as customers
          from sales_invoices
         where date >= ${start} and date < ${end}`
    ),
    // Grouped on a normalised name so "Abebe Trading" and "abebe trading " are
    // one customer; the most common spelling is what the chart shows.
    guard(
      sql<{ customer: string; cash: string; credit: string; tons: string; sales: string }[]>`
        select mode() within group (order by trim(customer)) as customer,
               coalesce(sum(invoice_cash), 0)   as cash,
               coalesce(sum(invoice_credit), 0) as credit,
               coalesce(sum(qty), 0)            as tons,
               count(*)                         as sales
          from sales_invoices
         where date >= ${start} and date < ${end}
         group by lower(trim(customer))
         order by sum(invoice_cash + invoice_credit) desc
         limit 12`
    ),
    guard(
      sql<{ code: string; tons: string; sales: string }[]>`
        select e.key as code,
               coalesce(sum((e.value)::numeric), 0) as tons,
               count(*) filter (where (e.value)::numeric > 0) as sales
          from sales_invoices s
          cross join lateral jsonb_each_text(s.products) as e(key, value)
         where s.date >= ${start} and s.date < ${end}
         group by e.key`
    ),
    guard(
      sql<{ date: string; cash: string; credit: string }[]>`
        with buckets as (
          select generate_series(
            date_trunc(${bucket}, (${start}::timestamptz at time zone ${EAT})),
            date_trunc(${bucket}, (${end}::timestamptz   at time zone ${EAT}) - interval '1 second'),
            ${step}::interval
          ) as b
        ),
        sales as (
          select date_trunc(${bucket}, date at time zone ${EAT}) as b,
                 sum(invoice_cash) as cash, sum(invoice_credit) as credit
            from sales_invoices
           where date >= ${start} and date < ${end}
           group by 1
        )
        select to_char(buckets.b, 'YYYY-MM-DD') as date,
               coalesce(sales.cash, 0) as cash, coalesce(sales.credit, 0) as credit
          from buckets left join sales on sales.b = buckets.b
         order by buckets.b`
    ),
    // A sale with no bank recorded is still a sale; it is shown as its own bar
    // rather than dropped, because "not recorded" is worth seeing too.
    guard(
      sql<{ bank: string; etb: string; sales: string }[]>`
        select coalesce(nullif(trim(bank), ''), '—') as bank,
               coalesce(sum(invoice_cash + invoice_credit), 0) as etb,
               count(*) as sales
          from sales_invoices
         where date >= ${start} and date < ${end}
         group by 1
         order by 2 desc`
    ),
  ]);

  const t = totals[0];
  if (!t) return empty;

  const tonsAll = products.reduce((a, p) => a + n(p.tons), 0);
  // Every brand on the sheet, plus any legacy code a row carries. The jsonb
  // only holds brands that were sold, so a brand nobody bought this window is
  // absent from the query — and that absence IS the "least sold" answer.
  const codes = orderProducts(Array.from(new Set([...PRODUCT_ORDER, ...products.map((p) => p.code)])));
  const byCode = new Map(products.map((p) => [p.code, p]));

  return {
    ...empty,
    totals: {
      sales: n(t.sales),
      etb: n(t.cash) + n(t.credit),
      cashEtb: n(t.cash),
      creditEtb: n(t.credit),
      tons: n(t.tons),
      customers: n(t.customers),
    },
    customers: customers.map((c) => ({
      customer: c.customer,
      etb: n(c.cash) + n(c.credit),
      cashEtb: n(c.cash),
      creditEtb: n(c.credit),
      tons: n(c.tons),
      sales: n(c.sales),
    })),
    // In sheet order, every brand that appeared — a brand at zero in the window
    // is the "least sold" answer, and it must not vanish just for being zero.
    products: codes.map((code) => {
      const p = byCode.get(code);
      const tons = p ? n(p.tons) : 0;
      return {
        code,
        tons,
        share: tonsAll > 0 ? Math.round((tons / tonsAll) * 1000) / 10 : 0,
        sales: p ? n(p.sales) : 0,
      };
    }),
    cashVsCredit: series.map((s) => ({ date: s.date, cash: n(s.cash), credit: n(s.credit) })),
    banks: banks.map((b) => ({ bank: b.bank, etb: n(b.etb), sales: n(b.sales) })),
  };
}
