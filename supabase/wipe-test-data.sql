-- ═══════════════════════════════════════════════════════════════════════════
--  Clear the sales test data — paste into the Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Empties the sales tab completely: every sales receipt, plus the cached
--  morning-brief row that keeps the landing page quoting figures for data that
--  is already gone.
--
--    STEP 1  counts what would go. Nothing is deleted.
--    STEP 2  deletes it, in one transaction.
--    STEP 3  re-run STEP 1 to confirm.
--
--  ⚠️ This is unconditional — it removes ALL sales receipts, not a date range.
--  It is meant for clearing test data before going live. If any genuine sale has
--  been filed through the bot, use supabase/wipe-one-day.sql instead, which
--  takes a date.
--
--  NOT touched: telegram_users, web_sessions, push_subscriptions — employees and
--  their logins. Nor any other department's reports; production, asset and
--  finance keep everything they have.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
--  STEP 1 — COUNT ONLY.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.test_data_counts()
returns table (tbl text, row_count bigint)
language plpgsql as $$
declare
  name text;
  n bigint;
  targets text[] := array['sales_receipts', 'briefs'];
begin
  foreach name in array targets loop
    if to_regclass('public.' || name) is null then
      continue;
    end if;
    execute format('select count(*) from %I', name) into n;
    if n > 0 then
      tbl := name;
      row_count := n;
      return next;
    end if;
  end loop;
end $$;

select * from pg_temp.test_data_counts() order by tbl;


-- ───────────────────────────────────────────────────────────────────────────
--  STEP 2 — DELETE. Run once STEP 1's numbers look right.
--
--  A DO block is atomic: if any statement fails the whole thing rolls back.
--  Each table reports its count in the Notices panel.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  name text;
  n bigint;
  total bigint := 0;
  targets text[] := array[
    -- Every sales report filed through the bot.
    'sales_receipts',
    -- The cached morning brief. The landing page renders this row directly, so
    -- without clearing it the dashboard keeps showing yesterday's sales figures
    -- after the receipts behind them are gone.
    'briefs'
  ];
begin
  foreach name in array targets loop
    if to_regclass('public.' || name) is null then
      raise notice '  skip   % (not in this database)', name;
      continue;
    end if;
    execute format('delete from %I', name);
    get diagnostics n = row_count;
    total := total + n;
    raise notice '  delete % → % row(s)', name, n;
  end loop;
  raise notice 'Done. % row(s) removed.', total;
end $$;


-- ───────────────────────────────────────────────────────────────────────────
--  STEP 3 — VERIFY. Re-run the SELECT from STEP 1.
--
--  It only lists tables with rows, so an EMPTY RESULT is the success condition.
-- ───────────────────────────────────────────────────────────────────────────
