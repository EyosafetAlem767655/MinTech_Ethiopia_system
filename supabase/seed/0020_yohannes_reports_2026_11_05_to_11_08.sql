-- Yohannes's reports for 5 to 8 Nov 2026, entered by hand (phone lost), in his
-- name and on their own days, so those days count as reported by him.
--
--   * Every day's stock = yesterday's stock + production - yesterday's delivered.
--   * 6/11 EC-90 production is 12 t (the voucher's figure; the owner confirmed).
--   * 5/11: its production and stock were already entered (seed 0018) and match
--     4/11 + production - delivered, so only its delivered and FGR are added.
--   * 7/11: 40kg Green Great Wall fell 8,100 -> 5,100. The 3,000 used are on file
--     from the team, so this seed no longer enters them (seed 0021).
--   * The rows seed 0018 wrote carried an internal marker in their FGR column;
--     it is cleared (5/11 gets its real FGR 9679/9723).
--
-- Re-runnable: it replaces its own rows. A day that already has a production
-- report keeps it, so nothing is counted twice.

begin;

/* Delivered, stock and bags: merged into each day, as the bot does. */
insert into daily_ops_reports (date_label, date, reported_by, delivered, stock, bags, raw_text, source, created_at)
select v.label, v.day, coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes'), v.delivered, v.stock, v.bags,
       'Entered by hand (phone lost)', 'app', v.day + interval '15 hours'
  from (values
  ('5/11/2026', '2026-11-05T00:00:00Z'::timestamptz, '{"ETL9":15.6,"2EL":5,"EC90":16}'::jsonb, '{}'::jsonb, '{}'::jsonb),
  ('6/11/2026', '2026-11-06T00:00:00Z'::timestamptz, '{"ETL9":35,"2EL":5,"EC90":10}'::jsonb, '{"ETL15":79.04,"ETL9":1191.9,"ETL6":76.92,"5EL":97.945,"2EL":466.62,"W2EL":0.375,"3EL":331.075,"EC15":232.975,"EC90":175,"Talk":508.275}'::jsonb, '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":8100,"Colorless@great-wall":72100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('7/11/2026', '2026-11-07T00:00:00Z'::timestamptz, '{"ETL9":25,"5EL":6,"3EL":5,"EC90":10}'::jsonb, '{"ETL15":80.72,"ETL9":1212.9,"ETL6":76.92,"5EL":97.945,"2EL":463.32,"W2EL":0.375,"3EL":331.075,"EC15":232.975,"EC90":192.6,"Talk":508.275}'::jsonb, '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":5100,"Colorless@great-wall":72100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('8/11/2026', '2026-11-08T00:00:00Z'::timestamptz, '{}'::jsonb, '{"ETL15":80.72,"ETL9":1214.14,"ETL6":76.92,"5EL":91.945,"2EL":463.32,"W2EL":0.375,"3EL":326.075,"EC15":232.975,"EC90":194.12,"Talk":508.275}'::jsonb, '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":5100,"Colorless@great-wall":72100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb)
  ) as v(label, day, delivered, stock, bags)
on conflict (date_label) do update set
  delivered = daily_ops_reports.delivered || excluded.delivered,
  stock = daily_ops_reports.stock || excluded.stock,
  bags = case when excluded.bags = '{}'::jsonb then daily_ops_reports.bags else jsonb_build_object(
    'kg25', coalesce(daily_ops_reports.bags -> 'kg25', '{}'::jsonb) || coalesce(excluded.bags -> 'kg25', '{}'::jsonb),
    'kg40', coalesce(daily_ops_reports.bags -> 'kg40', '{}'::jsonb) || coalesce(excluded.bags -> 'kg40', '{}'::jsonb)
  ) end,
  updated_at = now();

/* Seed 0018's rows: the internal marker out of the FGR column, 5/11's real FGR in. */
update production_reports
   set fgr_no = case when (date at time zone 'Africa/Addis_Ababa')::date = date '2026-11-05' then '9679/9723' else null end
 where fgr_no = 'manual-2026-11-phone-lost';

/* Production for 6 to 8 Nov. */
delete from production_reports
 where source = 'app'
   and created_at in ('2026-11-06T18:00:00+03:00', '2026-11-07T18:00:00+03:00', '2026-11-08T18:00:00+03:00')
   and reported_by = coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes');

insert into production_reports (date, fgr_no, reported_by, products, source, created_at)
select (v.day || 'T00:00:00Z')::timestamptz, v.fgr, coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes'), v.products, 'app',
       (v.day || 'T18:00:00+03:00')::timestamptz
  from (values
  ('2026-11-06', '{"2EL":16.35,"EC90":12}'::jsonb, null),
  ('2026-11-07', '{"ETL15":1.68,"ETL9":56,"2EL":1.7,"EC90":27.6}'::jsonb, '9681/9725'),
  ('2026-11-08', '{"ETL9":26.24,"EC90":11.52}'::jsonb, '9682')
  ) as v(day, products, fgr)
 where not exists (
   select 1 from production_reports p
    where (p.date at time zone 'Africa/Addis_Ababa')::date = (v.day)::date
 );

/* 7/11: the 3,000 Great Wall 40kg Green bags used are on file from the team
   (see seed 0021), so they are no longer entered here. */

/* Tick him on the attendance calendar for 6, 7 and 8 Nov (5/11 is ticked by 0018). */
delete from bot_activity where detail = 'Entered by hand (phone lost, 6-8 Nov)';

insert into bot_activity (chat_id, actor, user_id, positions, audience, action, detail, created_at)
select coalesce(u.chat_id, 'manual'), w.name, u.id, coalesce(u.positions, '{}'), 'internal', 'submission',
       'Entered by hand (phone lost, 6-8 Nov)', (d || 'T18:00:00+03:00')::timestamptz
  from (select coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes') as name) w
  left join telegram_users u on u.full_name = w.name
 cross join unnest(array['2026-11-06', '2026-11-07', '2026-11-08']) as d;

commit;

-- Check: 3 new production reports (153.09 t), 3 days ticked.
select reported_by, count(*) as reports,
       sum((select coalesce(sum(value::numeric), 0) from jsonb_each_text(products))) as tons
  from production_reports
 where created_at in ('2026-11-06T18:00:00+03:00', '2026-11-07T18:00:00+03:00', '2026-11-08T18:00:00+03:00')
 group by 1;
