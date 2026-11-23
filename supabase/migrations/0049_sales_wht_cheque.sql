-- WHT on sales, and how a cash sale was paid (owner, 23 Nov 2026).
--
-- A buyer with a TIN withholds 3% of the price BEFORE VAT on a purchase of
-- 20,000 birr or more (before VAT), so what the company actually receives is
-- the invoice less that 3%. The sales figures are kept at that net amount.
--
--   gross_cash / gross_credit  the invoice after VAT, exactly as filed
--   wht_amount                 3% of the price before VAT, or 0
--   invoice_cash / _credit     the invoice less the WHT: what every report adds up
--
-- Reversible: invoice_cash = gross_cash, invoice_credit = gross_credit undoes it.
--
-- Also from the sales report:
--   wht_received    the WHT receipt was handed over (null: not asked)
--   paid_by_cheque  the cash part was paid by cheque (null: not asked)
--
-- Additive: new columns and a function; nothing changes until the function runs.

alter table sales_invoices add column if not exists gross_cash     numeric(16,2);
alter table sales_invoices add column if not exists gross_credit   numeric(16,2);
alter table sales_invoices add column if not exists wht_amount     numeric(16,2);
alter table sales_invoices add column if not exists wht_received   boolean;
alter table sales_invoices add column if not exists paid_by_cheque boolean;

/*
 * Takes the WHT off every sale that has not been through it yet (gross_cash is
 * null), and returns how many sales had WHT taken off. Safe to call any number
 * of times: a sale is only ever reduced once.
 *
 * Not reduced (kept as they are, gross = amount, WHT 0):
 *   * no 10-digit TIN, or under 20,000 birr before VAT;
 *   * the owner's statement of uncollected credit sales and the October cash
 *     collection summary (seed 0022): those amounts are already at net pay.
 */
create or replace function apply_sales_wht() returns integer
language plpgsql as $$
declare
  reduced integer;
begin
  update sales_invoices
     set gross_cash = invoice_cash, gross_credit = invoice_credit, wht_amount = 0
   where gross_cash is null
     and (reported_by in ('credit statement 31 Oct 2026', 'cash collection summary Oct 2026')
          or coalesce(tin, '') !~ '^[0-9]{10}$'
          or (invoice_cash + invoice_credit) / 1.15 < 20000);

  -- Split between the cash and credit parts in proportion. Every expression
  -- reads the row as it was before this update.
  update sales_invoices
     set gross_cash = invoice_cash,
         gross_credit = invoice_credit,
         wht_amount = round(0.03 * (invoice_cash + invoice_credit) / 1.15, 2),
         invoice_cash = invoice_cash - round(
           round(0.03 * (invoice_cash + invoice_credit) / 1.15, 2) * invoice_cash / (invoice_cash + invoice_credit), 2),
         invoice_credit = invoice_credit - (
           round(0.03 * (invoice_cash + invoice_credit) / 1.15, 2)
           - round(round(0.03 * (invoice_cash + invoice_credit) / 1.15, 2) * invoice_cash / (invoice_cash + invoice_credit), 2)),
         updated_at = now()
   where gross_cash is null;
  get diagnostics reduced = row_count;
  return reduced;
end $$;
