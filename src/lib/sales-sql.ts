import sql from "@/lib/sql";

/**
 * SQL shared by everything that reads sales per bank or per customer.
 *
 * Both depend on columns from migration 0039 (`banks`, `tin`). Until it is run
 * every reader falls back to the old shape — one bank per sale, customers by
 * name — instead of failing: `withSalesFallback` retries with `legacy = true`
 * on "column does not exist" (42703).
 *
 * Functions, not constants: a fragment built at import time would open the
 * database client while Next collects page data at build time.
 */

/**
 * One row per (sale, bank) with the CASH that bank received.
 *
 * A sale paid into several banks has an entry per bank in `banks`; a sale with
 * one bank, or filed before 0039, puts its whole cash invoice on `bank`.
 * Columns: id, date, date_label, created_at, customer, tin, delivery_no, bank, cash.
 */
export function salesBankLines(legacy: boolean) {
  if (legacy) {
    return sql`
      select id, date, date_label, created_at, customer, null::text as tin, delivery_no,
             nullif(trim(bank), '') as bank, invoice_cash as cash
        from sales_invoices
       where invoice_cash > 0`;
  }
  return sql`
    select s.id, s.date, s.date_label, s.created_at, s.customer, s.tin, s.delivery_no, b.bank, b.cash
      from sales_invoices s
      cross join lateral (
        select nullif(trim(e->>'bank'), '') as bank, coalesce((e->>'amount')::numeric, 0) as cash
          from jsonb_array_elements(
                 case when jsonb_typeof(s.banks) = 'array' and jsonb_array_length(s.banks) > 1 then s.banks end
               ) e
        union all
        select nullif(trim(s.bank), ''), s.invoice_cash
         where not (jsonb_typeof(s.banks) = 'array' and jsonb_array_length(s.banks) > 1)
            or s.banks is null
      ) b
     where s.invoice_cash > 0`;
}

/**
 * Who a sale belongs to: the TIN where one is recorded, otherwise the name with
 * case and spacing ignored. Prefixed so a name can never equal a TIN.
 */
export function customerIdentity(legacy: boolean) {
  return legacy
    ? sql`'name:' || lower(regexp_replace(trim(customer), '\\s+', ' ', 'g'))`
    : sql`coalesce('tin:' || tin, 'name:' || lower(regexp_replace(trim(customer), '\\s+', ' ', 'g')))`;
}

/** Run with the 0039 columns; on 42703 (not migrated yet) run the old shape. */
export async function withSalesFallback<T>(run: (legacy: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (e) {
    if ((e as { code?: string })?.code !== "42703") throw e;
    return run(true);
  }
}
