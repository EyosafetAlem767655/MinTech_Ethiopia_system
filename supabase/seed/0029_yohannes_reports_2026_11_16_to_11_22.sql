-- Yohannes's reports for 16 to 22 Nov 2026, entered by hand (phone lost), in his
-- name and on their own days, as seed 0025 did for 9 to 16 Nov.
--
--   * "Received" is the day's production.
--   * Delivered is NOT written (owner, 23 Nov 2026): it was given only as a
--     check. stock(d) = stock(d-1) + received(d) - delivered(d-1) holds on
--     every day. A day's existing Delivered is left exactly as it is.
--   * PP bags (owner, 23 Nov 2026): the jumps on the 20th (+50,700 25kg Great
--     Wall colorless) and the 21st (+16,273 40kg Great Wall colorless) were
--     already filed as received, so nothing is added for them. Every November
--     day whose bag count DROPPED and that has no bag-usage report gets the drop
--     as that day's usage ("From daily bag count"). Whatever the stock check
--     still shows after that is closed with one "Count adjustment" line per bag
--     kind on the latest count day, so every gap is 0.
--
-- Run it AFTER any November bag receipts or usage are filed: the adjustment
-- closes whatever is left at the moment it runs.
--
-- Re-runnable: it replaces its own rows. A day that already has a production
-- report or a bag-usage report keeps it.
--
-- To UNDO the bag lines:
--   delete from pp_bag_usage_items where reference_no in ('From daily bag count', 'Count adjustment');
--   delete from pp_bag_usage u where not exists (select 1 from pp_bag_usage_items i where i.usage_id = u.id);

begin;

/* Stock and bags for 17 to 22 Nov, merged into each day. Delivered is not touched. */
insert into daily_ops_reports (date_label, date, reported_by, delivered, stock, bags, raw_text, source, created_at)
select v.label, v.day, coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes'), v.delivered, v.stock, v.bags,
       'Entered by hand (phone lost)', 'app', v.day + interval '15 hours'
  from (values
  ('17/11/2026', '2026-11-17T00:00:00Z'::timestamptz,
   '{}'::jsonb,
   '{"ETL15":65.72,"ETL9":1305.34,"ETL6":76.64,"5EL":77.27,"2EL":453.28,"W2EL":0.375,"3EL":309.325,"EC15":226.975,"EC90":335.24,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":8350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":64100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('18/11/2026', '2026-11-18T00:00:00Z'::timestamptz,
   '{}'::jsonb,
   '{"ETL15":65.72,"ETL9":1291.34,"ETL6":76.64,"5EL":20.52,"2EL":453.28,"W2EL":0.375,"3EL":309.325,"EC15":226.975,"EC90":354.44,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":6350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":62100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('19/11/2026', '2026-11-19T00:00:00Z'::timestamptz,
   '{}'::jsonb,
   '{"ETL15":65.72,"ETL9":1291.34,"ETL6":76.64,"5EL":39.895,"2EL":453.28,"W2EL":0.375,"3EL":309.325,"EC15":222.975,"EC90":371.64,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":3350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":62100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('20/11/2026', '2026-11-20T00:00:00Z'::timestamptz,
   '{}'::jsonb,
   '{"ETL15":65.72,"ETL9":1256.34,"ETL6":76.64,"5EL":46.395,"2EL":452.78,"W2EL":0.375,"3EL":304.325,"EC15":222.975,"EC90":371.4,"Talk":503.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":3350,"Colorless@great-wall":71257,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":62100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('21/11/2026', '2026-11-21T00:00:00Z'::timestamptz,
   '{}'::jsonb,
   '{"ETL15":65.72,"ETL9":1239.34,"ETL6":76.64,"5EL":70.42,"2EL":452.78,"W2EL":0.375,"3EL":299.325,"EC15":222.975,"EC90":387.6,"Talk":503.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":3350,"Colorless@great-wall":71257,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":78373,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('22/11/2026', '2026-11-22T00:00:00Z'::timestamptz,
   '{}'::jsonb,
   '{"ETL15":65.72,"ETL9":1220.34,"ETL6":76.64,"5EL":79.67,"2EL":452.78,"W2EL":0.375,"3EL":299.325,"EC15":222.975,"EC90":401.84,"Talk":498.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":3350,"Colorless@great-wall":71257,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":78373,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb)
  ) as v(label, day, delivered, stock, bags)
on conflict (date_label) do update set
  delivered = daily_ops_reports.delivered,
  stock = daily_ops_reports.stock || excluded.stock,
  bags = case when excluded.bags = '{}'::jsonb then daily_ops_reports.bags else jsonb_build_object(
    'kg25', coalesce(daily_ops_reports.bags -> 'kg25', '{}'::jsonb) || coalesce(excluded.bags -> 'kg25', '{}'::jsonb),
    'kg40', coalesce(daily_ops_reports.bags -> 'kg40', '{}'::jsonb) || coalesce(excluded.bags -> 'kg40', '{}'::jsonb)
  ) end,
  updated_at = now();

/* Production for 17 to 22 Nov ("Received"). */
delete from production_reports
 where source = 'app'
   and created_at in ('2026-11-17T18:00:00+03:00', '2026-11-18T18:00:00+03:00', '2026-11-19T18:00:00+03:00',
                      '2026-11-20T18:00:00+03:00', '2026-11-21T18:00:00+03:00', '2026-11-22T18:00:00+03:00')
   and reported_by = coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes');

insert into production_reports (date, fgr_no, reported_by, products, source, created_at)
select (v.day || 'T00:00:00Z')::timestamptz, null, coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes'), v.products, 'app',
       (v.day || 'T18:00:00+03:00')::timestamptz
  from (values
  ('2026-11-17', '{"5EL":23.75,"EC90":27.08}'::jsonb),
  ('2026-11-18', '{"5EL":23.25,"EC90":19.2}'::jsonb),
  ('2026-11-19', '{"5EL":19.375,"EC90":22.2}'::jsonb),
  ('2026-11-20', '{"5EL":7,"EC90":5.76}'::jsonb),
  ('2026-11-21', '{"5EL":24.025,"EC90":27.2}'::jsonb),
  ('2026-11-22', '{"5EL":14.25,"EC90":25.24}'::jsonb)
  ) as v(day, products)
 where not exists (
   select 1 from production_reports p
    where (p.date at time zone 'Africa/Addis_Ababa')::date = (v.day)::date
 );

/* Tick him on the attendance calendar for 17 to 22 Nov. */
delete from bot_activity where detail = 'Entered by hand (phone lost, 17-22 Nov)';

insert into bot_activity (chat_id, actor, user_id, positions, audience, action, detail, created_at)
select coalesce(u.chat_id, 'manual'), w.name, u.id, coalesce(u.positions, '{}'), 'internal', 'submission',
       'Entered by hand (phone lost, 17-22 Nov)', (d || 'T18:00:00+03:00')::timestamptz
  from (select coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes') as name) w
  left join telegram_users u on u.full_name = w.name
 cross join unnest(array['2026-11-17', '2026-11-18', '2026-11-19',
                         '2026-11-20', '2026-11-21', '2026-11-22']) as d;

/*
 * PP bags: November's gap to 0, the way the stock check works it out
 * (src/lib/stock-reconciliation.ts):
 *   gap = latest count − (opening + received − issued)
 * The results are kept in bag_gap_check for the check at the end.
 */
create temp table if not exists bag_gap_check (
  bag text, counted numeric, expected_before numeric, adjustment numeric, note text
) on commit preserve rows;
truncate bag_gap_check;

do $$
declare
  m_start constant timestamptz := '2026-10-31T21:00:00Z';   -- 1 Nov, 00:00 EAT
  m_end   constant timestamptz := '2026-11-30T21:00:00Z';   -- 1 Dec, 00:00 EAT
  companies_since constant timestamptz := '2026-10-23T00:00:00Z';
  kinds constant text[] := array[
    'kg25:Yellow@great-wall', 'kg25:White@great-wall', 'kg25:Beige@great-wall', 'kg25:Colorless@great-wall',
    'kg40:Yellow@great-wall', 'kg40:Green@great-wall', 'kg40:Beige@great-wall', 'kg40:Colorless@great-wall',
    'kg25:Yellow@ethio-india', 'kg25:White@ethio-india', 'kg25:Beige@ethio-india', 'kg25:Colorless@ethio-india',
    'kg40:Yellow@ethio-india', 'kg40:Green@ethio-india', 'kg40:Beige@ethio-india', 'kg40:Colorless@ethio-india'];
  who text;
  k text; sz text; col text;
  prev_bags jsonb; c record;
  drop_qty numeric; day_label text; uid uuid; pos int;
  filed jsonb; earlier record; pre record; first_co record; latest record;
  base jsonb := '{}'::jsonb; after_ts timestamptz := 'epoch';
  has_siv boolean;
  received numeric; issued numeric; base_qty numeric; counted numeric; expected numeric; gap numeric;
begin
  who := coalesce(
    (select full_name from telegram_users
      where full_name ilike 'yohannes%' and archived_at is null
      order by ('prod_daily' = any(positions)) desc, full_name
      limit 1),
    'Yohannes');

  -- Clear this seed's own lines from an earlier run, and any usage day left empty.
  delete from pp_bag_usage_items i
   using pp_bag_usage u
   where u.id = i.usage_id and u.date >= m_start and u.date < m_end
     and i.reference_no in ('From daily bag count', 'Count adjustment');
  delete from pp_bag_usage u
   where u.date >= m_start and u.date < m_end and u.source = 'app' and u.reported_by = who
     and not exists (select 1 from pp_bag_usage_items i where i.usage_id = u.id);

  /* 1. Day by day: a drop in the count on a day with no usage report is that day's usage. */
  select bags into prev_bags
    from daily_ops_reports
   where date >= companies_since and date < m_start and bags::text like '%@%'
   order by date desc limit 1;

  for c in
    select date, bags from daily_ops_reports
     where date >= greatest(m_start, companies_since) and date < m_end and bags::text like '%@%'
     order by date
  loop
    day_label := to_char((c.date at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD');
    if prev_bags is not null and not exists (select 1 from pp_bag_usage where date_label = day_label) then
      uid := null;
      pos := 0;
      foreach k in array kinds loop
        sz := split_part(k, ':', 1);
        col := substr(k, length(sz) + 2);
        drop_qty := coalesce((prev_bags -> sz ->> col)::numeric, 0) - coalesce((c.bags -> sz ->> col)::numeric, 0);
        if drop_qty > 0 then
          if uid is null then
            insert into pp_bag_usage (date_label, date, reported_by, source)
            values (day_label, c.date, who, 'app')
            returning id into uid;
          end if;
          insert into pp_bag_usage_items (usage_id, position, ledger_key, reference_no, quantity)
          values (uid, pos, k, 'From daily bag count', drop_qty);
          pos := pos + 1;
        end if;
      end loop;
    end if;
    prev_bags := c.bags;
  end loop;

  /* 2. The opening, as month-opening.ts takes it. */
  select bags into filed from monthly_base_balances where month = '2026-11';
  select month, bags into earlier from monthly_base_balances
   where month < '2026-11' and bags is not null and bags <> '{}'::jsonb
   order by month desc limit 1;
  select date, bags into pre from daily_ops_reports
   where date < m_start and bags is not null and bags::text <> '{}'
   order by date desc limit 1;

  if filed is not null and filed <> '{}'::jsonb then
    base := filed;
  elsif earlier.month is not null
        and not (pre.date is not null
                 and pre.date >= (earlier.month || '-01T00:00:00Z')::timestamptz - interval '3 hours') then
    base := earlier.bags;
  elsif pre.date is not null then
    select coalesce(jsonb_object_agg(s.key || ':' || cc.key, cc.value), '{}'::jsonb) into base
      from jsonb_each(pre.bags) s
     cross join lateral jsonb_each(case when jsonb_typeof(s.value) = 'object' then s.value else '{}'::jsonb end) cc;
  end if;

  -- No company bags in the opening: the month's first per-company count is.
  if not exists (select 1 from jsonb_object_keys(base) x where x like '%@%') then
    select date, bags into first_co from daily_ops_reports
     where date >= greatest(m_start, companies_since) and date < m_end and bags::text like '%@%'
     order by date asc limit 1;
    if first_co.date is not null then
      select base || coalesce(jsonb_object_agg(s.key || ':' || cc.key, cc.value), '{}'::jsonb) into base
        from jsonb_each(first_co.bags) s
       cross join lateral jsonb_each(case when jsonb_typeof(s.value) = 'object' then s.value else '{}'::jsonb end) cc
       where cc.key like '%@%';
      after_ts := first_co.date;
    end if;
  end if;

  has_siv := exists (
    select 1 from store_issue_items i join store_issue_vouchers v on v.id = i.siv_id
     where v.date >= m_start and v.date < m_end
       and i.ledger_kind = 'bag' and i.ledger_key is not null
       and (i.ledger_key not like '%@%' or v.date > after_ts));

  select date, date_label, bags into latest from daily_ops_reports
   where date >= m_start and date < m_end and bags is not null and bags::text <> '{}'
   order by date desc limit 1;
  if latest.date is null then
    raise notice 'No November bag count: nothing to check.';
    return;
  end if;

  /* 3. The gap per kind, and one adjustment line where it is not 0. */
  day_label := to_char((latest.date at time zone 'Africa/Addis_Ababa')::date, 'YYYY-MM-DD');
  uid := (select id from pp_bag_usage where date_label = day_label);
  pos := coalesce((select max(position) + 1 from pp_bag_usage_items where pp_bag_usage_items.usage_id = uid), 0);

  foreach k in array kinds loop
    sz := split_part(k, ':', 1);
    col := substr(k, length(sz) + 2);
    base_qty := coalesce((base ->> k)::numeric, 0);
    received := coalesce((
      select sum(i.ledger_qty) from goods_receiving_items i join goods_receiving_vouchers v on v.id = i.grv_id
       where v.date >= m_start and v.date < m_end and i.ledger_kind = 'bag' and i.ledger_key = k
         and v.date > after_ts), 0)
      + coalesce((
      select sum(coalesce((p.bags -> sz ->> col)::numeric, 0)) from pp_bag_purchases p
       where p.date >= m_start and p.date < m_end and p.date > after_ts
         and jsonb_typeof(p.bags -> sz) = 'object'), 0);
    if has_siv then
      issued := coalesce((
        select sum(i.ledger_qty) from store_issue_items i join store_issue_vouchers v on v.id = i.siv_id
         where v.date >= m_start and v.date < m_end and i.ledger_kind = 'bag' and i.ledger_key = k
           and v.date > after_ts), 0);
    else
      issued := coalesce((
        select sum(i.quantity) from pp_bag_usage_items i join pp_bag_usage u on u.id = i.usage_id
         where u.date >= m_start and u.date < m_end and i.ledger_key = k and u.date > after_ts), 0);
    end if;
    counted := coalesce((latest.bags -> sz ->> col)::numeric, 0);
    expected := base_qty + received - issued;
    gap := counted - expected;

    if gap = 0 then
      insert into bag_gap_check values (k, counted, expected, 0, 'already 0');
    elsif has_siv then
      insert into bag_gap_check values (k, counted, expected, 0,
        'NOT closed: November has store issue vouchers for bags, so the check ignores bag usage');
    else
      if uid is null then
        insert into pp_bag_usage (date_label, date, reported_by, source)
        values (day_label, latest.date, who, 'app')
        returning id into uid;
      end if;
      -- A shortfall (gap < 0) is bags used; a surplus goes in as a negative line.
      insert into pp_bag_usage_items (usage_id, position, ledger_key, reference_no, quantity)
      values (uid, pos, k, 'Count adjustment', -gap);
      pos := pos + 1;
      insert into bag_gap_check values (k, counted, expected, -gap, 'closed by a count adjustment');
    end if;
  end loop;
end $$;

commit;

-- Check 1: the bag stock check for November. Gap after = counted − (expected before − adjustment) = 0.
select bag, counted, expected_before, adjustment,
       counted - (expected_before - adjustment) as gap_after, note
  from bag_gap_check order by bag;

-- Check 2: bag usage written for November, per day.
select u.date_label, i.ledger_key, i.reference_no, i.quantity
  from pp_bag_usage u join pp_bag_usage_items i on i.usage_id = u.id
 where u.date >= '2026-10-31T21:00:00Z' and u.date < '2026-11-30T21:00:00Z'
 order by u.date_label, i.position;

-- Check 3: up to 6 new production reports (238.33 t if none of those days had one).
select reported_by, count(*) as reports,
       sum((select coalesce(sum(value::numeric), 0) from jsonb_each_text(products))) as tons
  from production_reports
 where created_at in ('2026-11-17T18:00:00+03:00', '2026-11-18T18:00:00+03:00', '2026-11-19T18:00:00+03:00',
                      '2026-11-20T18:00:00+03:00', '2026-11-21T18:00:00+03:00', '2026-11-22T18:00:00+03:00')
 group by 1;
