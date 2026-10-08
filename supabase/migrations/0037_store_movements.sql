-- The warehouse list on the vouchers, and what each item costs.
--
-- Both vouchers (GRV in, SIV out) now pick their lines from the store list in
-- src/lib/store-items.ts instead of having every line typed. A picked line is
-- saved with ledger_kind = 'store' and ledger_key = the item's permanent key,
-- which is what lets the inventory work out a running balance:
--     last count + received since − issued since.
-- The bag and raw-material queries already filter on their own kinds, so a
-- 'store' line can never leak into the bag stock check or the finance report.

alter table goods_receiving_items drop constraint if exists goods_receiving_items_ledger_kind_check;
alter table goods_receiving_items add constraint goods_receiving_items_ledger_kind_check
  check (ledger_kind is null or ledger_kind in ('bag', 'material', 'store'));

alter table store_issue_items drop constraint if exists store_issue_items_ledger_kind_check;
alter table store_issue_items add constraint store_issue_items_ledger_kind_check
  check (ledger_kind is null or ledger_kind in ('bag', 'material', 'store'));

-- What one warehouse item costs, as a HISTORY rather than one overwritten
-- figure. A GRV records the price it paid, dated with the voucher; a correction
-- made on the web (Finance → Monthly) is dated the 1st of the month it was made
-- for. The cost of an item is then always "on this date", so a price entered
-- today never revalues an issue that happened months ago.
create table if not exists store_item_costs (
  id             uuid primary key default gen_random_uuid(),
  item_key       text not null,                       -- e.g. 'brg:6210'
  unit_cost      numeric(14,2) not null check (unit_cost > 0),
  effective_from date not null,
  source         text not null check (source in ('grv', 'web')),
  ref            text,                                -- the GRV number, when there is one
  recorded_by    text not null,
  created_at     timestamptz not null default now()
);

create index if not exists store_item_costs_item_idx
  on store_item_costs (item_key, effective_from desc, created_at desc);

-- Same posture as every other table here: no Data API, no policies.
-- See 0031_data_api_lockdown.sql.
alter table store_item_costs enable row level security;
alter table store_item_costs force  row level security;
