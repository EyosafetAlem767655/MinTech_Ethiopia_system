-- Take the 3% WHT off every sale already on file (owner, 23 Nov 2026).
--
-- Run migration 0049 FIRST: it adds the columns and apply_sales_wht().
--
-- Rule: a buyer with a 10-digit TIN, on a sale of 20,000 birr or more BEFORE
-- VAT, withholds 3% of the price before VAT:
--   WHT = 3% × invoice / 1.15     (115,000 → WHT 3,000 → 112,000)
-- Not reduced: sales without a TIN, smaller sales, and the owner's statement of
-- uncollected credit sales / October collection summary (seed 0022), which are
-- already at net pay. The invoice as filed is kept in gross_cash / gross_credit.
--
-- A copy of every sale is kept first in sales_wht_backup_2026_11.
--
-- SAFE TO RE-RUN: a sale is only ever reduced once (gross_cash is set the
-- first time); a second run changes nothing.
--
-- To UNDO (puts every invoice back to its full amount):
--   update sales_invoices set invoice_cash = gross_cash, invoice_credit = gross_credit,
--          gross_cash = null, gross_credit = null, wht_amount = null
--    where gross_cash is not null;

begin;

create table if not exists sales_wht_backup_2026_11 as select * from sales_invoices where false;
alter table sales_wht_backup_2026_11 enable row level security;

insert into sales_wht_backup_2026_11
select i.* from sales_invoices i
 where i.gross_cash is null
   and not exists (select 1 from sales_wht_backup_2026_11 b where b.id = i.id);

select apply_sales_wht() as sales_reduced_now;

commit;

-- Check, per month: sales with WHT taken off, the WHT, and what is now counted.
select to_char((date at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM') as month,
       count(*)                                         as sales,
       count(*) filter (where wht_amount > 0)            as sales_with_wht,
       round(sum(gross_cash + gross_credit), 2)          as invoiced_after_vat,
       round(sum(wht_amount), 2)                         as wht_3pct,
       round(sum(invoice_cash + invoice_credit), 2)      as net_counted
  from sales_invoices
 group by 1
 order by 1;
