-- ═══════════════════════════════════════════════════════════════════════════
--  Wipe one day's submissions — paste into the Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Removes everything filed on a single Ethiopian calendar day, across Sales,
--  Finance, Asset Management and Production. Run it in two passes:
--
--    STEP 1  counts what would go, per table. Read it. Nothing is deleted.
--    STEP 2  deletes exactly those rows, in one transaction.
--    STEP 3  re-run STEP 1 to confirm the day is empty.
--
--  Rows are matched on `created_at` — WHEN THE REPORT WAS FILED, not the date
--  written inside it. "The data I submitted today" is a statement about the
--  filing: a report entered today about last Tuesday is today's submission and
--  goes; a report entered last week about today stays.
--
--  ── THE DAY ───────────────────────────────────────────────────────────────
--  Set in ONE place in each step, in Ethiopian local time (UTC+3). The window
--  is [day 00:00 EAT, next day 00:00 EAT).
--
--      '2026-08-31'  the day the request was made
--      '2026-09-01'  the day after
--
--  Both steps below are set to 2026-08-31. Change both if you mean another day.
--
--  ── WHAT IS NOT TOUCHED, DELIBERATELY ─────────────────────────────────────
--    • telegram_users, web_sessions, push_subscriptions — employees and their
--      logins. Wiping these locks everyone out of the bot.
--    • Child rows (damage photos, purchase line items, the WHT SMS log) go
--      automatically with their parent through `on delete cascade`.
--    • stored_files — the image binaries. The photo-purge cron reaps the
--      orphans on its own schedule; deleting the rows here would leave the
--      files themselves in the storage bucket with nothing pointing at them.
--
--  Tables this database does not have are skipped with a notice rather than
--  failing the run, so a pending migration cannot abort the wipe halfway.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  STEP 1 — COUNT ONLY. Run this first and read the result.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.day_counts(d_start timestamptz, d_end timestamptz)
returns table (section text, tbl text, row_count bigint)
language plpgsql as $$
declare
  entry text;
  n bigint;
  targets text[] := array[
    'Production:production_reports',
    'Production:daily_ops_reports',
    'Production:stock_status_reports',
    'Production:shift_reports',
    'Production:damage_claims',
    'Asset:raw_material_receipts',
    'Asset:delivery_reports',
    'Asset:material_issues',
    'Asset:monthly_base_balances',
    'Asset:pp_bag_damage_reports',
    'Asset:pp_bag_purchases',
    'Asset:purchase_requests',
    'Asset:purchase_item_reports',
    'Asset:material_counts',
    'Asset:stone_deliveries',
    'Sales:sales_receipts',
    'Finance:finance_purchase_batches',
    'Finance:monthly_price_lists',
    'Finance:wht_holders',
    'Finance:receipts',
    'Asset:store_issue_vouchers',
    'Finance:goods_receiving_vouchers',
    'Other:daily_reports',
    'Other:hr_reports',
    -- The landing page reads a cached brief row, which is why the dashboard
    -- still showed yesterday's figures after the tables behind it were emptied.
    'Other:briefs'
  ];
  sec text;
  name text;
begin
  foreach entry in array targets loop
    sec  := split_part(entry, ':', 1);
    name := split_part(entry, ':', 2);
    if to_regclass('public.' || name) is null then
      continue;
    end if;
    execute format('select count(*) from %I where created_at >= $1 and created_at < $2', name)
      into n using d_start, d_end;
    if n > 0 then
      section := sec;
      tbl := name;
      row_count := n;
      return next;
    end if;
  end loop;
end $$;

select * from pg_temp.day_counts(
  (date '2026-08-31' + time '00:00') at time zone 'Africa/Addis_Ababa',
  (date '2026-08-31' + interval '1 day') at time zone 'Africa/Addis_Ababa'
) order by section, tbl;


-- ───────────────────────────────────────────────────────────────────────────
--  STEP 2 — DELETE. Run only once STEP 1's numbers look right.
--
--  A DO block is atomic: if any statement fails, the whole thing rolls back.
--  You cannot end up with Production wiped and Sales still there.
--
--  Each table reports its own count in the Notices panel.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  name text;
  n bigint;
  total bigint := 0;
  d_start timestamptz := (date '2026-08-31' + time '00:00') at time zone 'Africa/Addis_Ababa';
  d_end   timestamptz := (date '2026-08-31' + interval '1 day') at time zone 'Africa/Addis_Ababa';
  targets text[] := array[
    'production_reports', 'daily_ops_reports', 'stock_status_reports', 'shift_reports',
    'damage_claims',
    'raw_material_receipts', 'delivery_reports', 'material_issues', 'monthly_base_balances',
    'pp_bag_damage_reports', 'pp_bag_purchases', 'purchase_requests', 'purchase_item_reports',
    'material_counts', 'stone_deliveries',
    'sales_receipts',
    'finance_purchase_batches', 'monthly_price_lists', 'wht_holders', 'receipts',
    -- The two paper vouchers. Their line items cascade with them.
    'goods_receiving_vouchers', 'store_issue_vouchers',
    'daily_reports', 'hr_reports',
    -- The cached morning brief the landing page renders. Without this the
    -- dashboard keeps showing figures for tables that are already empty.
    'briefs'
  ];
begin
  raise notice 'Wiping submissions filed between % and %', d_start, d_end;

  foreach name in array targets loop
    if to_regclass('public.' || name) is null then
      raise notice '  skip   % (not in this database)', name;
      continue;
    end if;
    execute format('delete from %I where created_at >= $1 and created_at < $2', name)
      using d_start, d_end;
    get diagnostics n = row_count;
    total := total + n;
    if n > 0 then
      raise notice '  delete % → % row(s)', name, n;
    end if;
  end loop;

  -- The recycle bin for the same day, so a wiped submission cannot be restored
  -- back onto the clean slate. Comment this block out to keep the bin intact.
  if to_regclass('public.deleted_submissions') is not null then
    delete from deleted_submissions where deleted_at >= d_start and deleted_at < d_end;
    get diagnostics n = row_count;
    total := total + n;
    raise notice '  delete deleted_submissions → % row(s)', n;
  end if;

  raise notice 'Done. % row(s) removed.', total;
end $$;


-- ───────────────────────────────────────────────────────────────────────────
--  STEP 3 — VERIFY. Re-run the SELECT from STEP 1.
--
--  It only lists tables with rows, so an EMPTY RESULT is the success condition.
-- ───────────────────────────────────────────────────────────────────────────
