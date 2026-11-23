-- Did the customer withhold the 3% WHT on this sale? (owner, 23 Nov 2026)
--
--   true   withheld: 3% before VAT is taken off, as 0049 does
--   false  not withheld: the full invoice is counted, nothing taken off
--   null   not asked (every sale before this): the 0049 rule applies
--
-- Adds one column. Nothing existing is changed. Safe to re-run.

alter table sales_invoices add column if not exists wht_withheld boolean;
