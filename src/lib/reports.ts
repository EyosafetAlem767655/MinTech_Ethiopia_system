import sql from "@/lib/sql";

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export function currentEatMonth(now = new Date()): string {
  const shifted = new Date(now.getTime() + EAT_OFFSET_MS);
  return shifted.toISOString().slice(0, 7);
}

export function eatMonthRange(month = currentEatMonth()) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthIndex - 1, 1) - EAT_OFFSET_MS);
  const end = new Date(Date.UTC(year, monthIndex, 1) - EAT_OFFSET_MS);
  return { month, start, end };
}

export async function monthlySalesReport(month = currentEatMonth()) {
  const { start, end } = eatMonthRange(month);

  const [totals, clientRows, categoryRows] = await Promise.all([
    // Five Mongo pipelines → one round trip. `payments` being a table means
    // cash collected no longer needs an $unwind.
    sql<
      {
        sacks: string; revenue: string; invoice_count: string;
        collected: string; payment_count: string;
        expenses: string; receipt_count: string;
      }[]
    >`
      select
        (select coalesce(sum(sacks),0)  from invoices where invoiced_at >= ${start} and invoiced_at < ${end}) as sacks,
        (select coalesce(sum(amount),0) from invoices where invoiced_at >= ${start} and invoiced_at < ${end}) as revenue,
        (select count(*)                from invoices where invoiced_at >= ${start} and invoiced_at < ${end}) as invoice_count,
        (select coalesce(sum(amount),0) from payments where date >= ${start} and date < ${end})               as collected,
        (select count(*)                from payments where date >= ${start} and date < ${end})               as payment_count,
        (select coalesce(sum(amount),0) from receipts where receipt_date >= ${start} and receipt_date < ${end}) as expenses,
        (select count(*)                from receipts where receipt_date >= ${start} and receipt_date < ${end}) as receipt_count
    `,
    sql<{ client: string; amount: string; sacks: string }[]>`
      select client, sum(amount) as amount, sum(sacks) as sacks
        from invoices
       where invoiced_at >= ${start} and invoiced_at < ${end}
       group by client
       order by amount desc
       limit 6
    `,
    sql<{ category: string; amount: string; count: string }[]>`
      select coalesce(category, 'Uncategorized') as category,
             sum(amount) as amount, count(*) as count
        from receipts
       where receipt_date >= ${start} and receipt_date < ${end}
       group by 1
       order by amount desc
       limit 6
    `,
  ]);

  const t = totals[0];
  const revenueInvoiced = Number(t.revenue) || 0;
  const cashCollected = Number(t.collected) || 0;
  const receiptExpenses = Number(t.expenses) || 0;

  return {
    month,
    sacksSold: Number(t.sacks) || 0,
    revenueInvoiced,
    cashCollected,
    receiptExpenses,
    netCash: cashCollected - receiptExpenses,
    invoiceCount: Number(t.invoice_count) || 0,
    receiptCount: Number(t.receipt_count) || 0,
    paymentCount: Number(t.payment_count) || 0,
    topClients: clientRows.map((r) => ({
      client: r.client || "Unknown",
      amount: Number(r.amount) || 0,
      sacks: Number(r.sacks) || 0,
    })),
    expenseCategories: categoryRows.map((r) => ({
      category: r.category || "Uncategorized",
      amount: Number(r.amount) || 0,
      count: Number(r.count) || 0,
    })),
  };
}
