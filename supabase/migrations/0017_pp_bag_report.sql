-- PP bag purchase report: asset management counts the bags, finance files the receipt.
--
-- Both departments record the same kind of event, so this is three columns on the
-- existing table rather than a second one. The split is in what each side fills:
--
--   asset   — the receipt AND the counts, by size and colour. This is the row the
--             monthly finance report reads for its bag "Received" line.
--   finance — the receipt only. Its bags map stays empty, so a purchase filed by
--             both departments cannot double the month's received quantity.

alter table pp_bag_purchases
  -- Which department's copy this is. Defaulting to 'finance' is correct for every
  -- row that already exists: finance is the only side that could file until now.
  add column if not exists filed_by_dept text not null default 'finance',
  -- The delivery-note / form number printed on the paper.
  add column if not exists dn_no text,
  -- What the AI read off the photos, including the lines it could NOT map to a
  -- known bag kind. Deliberately separate from receipt_check, which stays the
  -- cross-check of the typed total against the printed one.
  add column if not exists extraction jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pp_bag_purchases_filed_by_dept_check'
  ) then
    alter table pp_bag_purchases
      add constraint pp_bag_purchases_filed_by_dept_check
      check (filed_by_dept in ('asset', 'finance'));
  end if;
end $$;

create index if not exists pp_bag_purchases_dept_idx on pp_bag_purchases (filed_by_dept, date desc);

-- The bags column needs no migration. It is jsonb, and an asset-filed row stores
-- the nested { kg25: { Yellow: n, ... }, kg40: { ... } } shape — the same shape
-- daily_ops_reports.bags has always used — while the flat { kg25: n } rows filed
-- before today keep reading correctly. bagSizeTotals() in src/lib/products.ts
-- accepts both, so nothing downstream has to know which shape it was handed.
