-- Yohannes's reports for 9 to 16 Nov 2026, entered by hand (phone lost), in his
-- name and on their own days, so those days count as reported by him.
--
--   * "Received" is the day's production.
--   * A day's Delivered comes off the NEXT day's stock (as in seed 0020):
--     stock(d) = stock(d-1) + received(d) - delivered(d-1). Every day checks out.
--   * 14/11 was written without the company split: his "2EL 458.655" is
--     2EL 458.28 + 2EL Welega 0.375, and "25kg yellow 1240" is Great Wall 240 +
--     Ethio-India 1000, exactly as the 13th and the 15th give them.
--   * PP bags: counts only. Drops are for the SIV / bag-use records to explain.
--   * 15/11 had no delivery; 16/11's delivered is not in yet (added later).
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
  ('9/11/2026', '2026-11-09T00:00:00Z'::timestamptz,
   '{"ETL9":19.68,"ETL6":0.28,"5EL":0.3,"3EL":5,"EC90":11}'::jsonb,
   '{"ETL15":80.72,"ETL9":1252.54,"ETL6":76.92,"5EL":91.945,"2EL":463.32,"W2EL":0.375,"3EL":326.075,"EC15":232.975,"EC90":220.52,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":5100,"Colorless@great-wall":72100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('10/11/2026', '2026-11-10T00:00:00Z'::timestamptz,
   '{"ETL15":5,"ETL9":15,"2EL":5.04,"EC15":1,"EC90":10}'::jsonb,
   '{"ETL15":80.72,"ETL9":1255.02,"ETL6":76.64,"5EL":91.645,"2EL":463.32,"W2EL":0.375,"3EL":321.075,"EC15":232.975,"EC90":229.92,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":70100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('11/11/2026', '2026-11-11T00:00:00Z'::timestamptz,
   '{"ETL9":19.48,"EC15":5,"EC90":11.52}'::jsonb,
   '{"ETL15":75.72,"ETL9":1297.62,"ETL6":76.64,"5EL":91.645,"2EL":458.28,"W2EL":0.375,"3EL":321.075,"EC15":231.975,"EC90":238.52,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":70100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('12/11/2026', '2026-11-12T00:00:00Z'::timestamptz,
   '{"ETL9":5,"EC90":10}'::jsonb,
   '{"ETL15":75.72,"ETL9":1278.14,"ETL6":76.64,"5EL":91.645,"2EL":458.28,"W2EL":0.375,"3EL":321.075,"EC15":226.975,"EC90":251.2,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":70100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('13/11/2026', '2026-11-13T00:00:00Z'::timestamptz,
   '{"ETL9":25,"5EL":7,"3EL":4.5,"EC90":16}'::jsonb,
   '{"ETL15":75.72,"ETL9":1287.74,"ETL6":76.64,"5EL":91.645,"2EL":458.28,"W2EL":0.375,"3EL":321.075,"EC15":226.975,"EC90":270,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":8350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":68100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('14/11/2026', '2026-11-14T00:00:00Z'::timestamptz,
   '{"ETL15":10,"5EL":40,"3EL":7.25,"EC90":10}'::jsonb,
   '{"ETL15":75.72,"ETL9":1280.34,"ETL6":76.64,"5EL":84.645,"2EL":458.28,"W2EL":0.375,"3EL":316.575,"EC15":226.975,"EC90":274.8,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":8350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":68100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('15/11/2026', '2026-11-15T00:00:00Z'::timestamptz,
   '{}'::jsonb,
   '{"ETL15":65.72,"ETL9":1304.34,"ETL6":76.64,"5EL":44.645,"2EL":458.28,"W2EL":0.375,"3EL":309.325,"EC15":226.975,"EC90":291.08,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":8350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":66100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('16/11/2026', '2026-11-16T00:00:00Z'::timestamptz,
   '{}'::jsonb,
   '{"ETL15":65.72,"ETL9":1305.94,"ETL6":76.64,"5EL":53.52,"2EL":458.28,"W2EL":0.375,"3EL":309.325,"EC15":226.975,"EC90":318.16,"Talk":508.275}'::jsonb,
   '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":8350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":3100,"Colorless@great-wall":64100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb)
  ) as v(label, day, delivered, stock, bags)
on conflict (date_label) do update set
  delivered = daily_ops_reports.delivered || excluded.delivered,
  stock = daily_ops_reports.stock || excluded.stock,
  bags = case when excluded.bags = '{}'::jsonb then daily_ops_reports.bags else jsonb_build_object(
    'kg25', coalesce(daily_ops_reports.bags -> 'kg25', '{}'::jsonb) || coalesce(excluded.bags -> 'kg25', '{}'::jsonb),
    'kg40', coalesce(daily_ops_reports.bags -> 'kg40', '{}'::jsonb) || coalesce(excluded.bags -> 'kg40', '{}'::jsonb)
  ) end,
  updated_at = now();

/* Production for 9 to 16 Nov ("Received"). */
delete from production_reports
 where source = 'app'
   and created_at in ('2026-11-09T18:00:00+03:00', '2026-11-10T18:00:00+03:00', '2026-11-11T18:00:00+03:00',
                      '2026-11-12T18:00:00+03:00', '2026-11-13T18:00:00+03:00', '2026-11-14T18:00:00+03:00',
                      '2026-11-15T18:00:00+03:00', '2026-11-16T18:00:00+03:00')
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
  ('2026-11-09', '{"ETL9":38.4,"EC90":26.4}'::jsonb),
  ('2026-11-10', '{"ETL9":22.16,"EC90":20.4}'::jsonb),
  ('2026-11-11', '{"ETL9":57.6,"EC90":18.6}'::jsonb),
  ('2026-11-12', '{"EC90":24.2}'::jsonb),
  ('2026-11-13', '{"ETL9":14.6,"EC90":28.8}'::jsonb),
  ('2026-11-14', '{"ETL9":17.6,"EC90":20.8}'::jsonb),
  ('2026-11-15', '{"ETL9":24,"EC90":26.28}'::jsonb),
  ('2026-11-16', '{"ETL9":1.6,"5EL":8.875,"EC90":27.08}'::jsonb)
  ) as v(day, products)
 where not exists (
   select 1 from production_reports p
    where (p.date at time zone 'Africa/Addis_Ababa')::date = (v.day)::date
 );

/* Tick him on the attendance calendar for 9 to 16 Nov. */
delete from bot_activity where detail = 'Entered by hand (phone lost, 9-16 Nov)';

insert into bot_activity (chat_id, actor, user_id, positions, audience, action, detail, created_at)
select coalesce(u.chat_id, 'manual'), w.name, u.id, coalesce(u.positions, '{}'), 'internal', 'submission',
       'Entered by hand (phone lost, 9-16 Nov)', (d || 'T18:00:00+03:00')::timestamptz
  from (select coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes') as name) w
  left join telegram_users u on u.full_name = w.name
 cross join unnest(array['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12',
                         '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']) as d;

commit;

-- Check: up to 8 new production reports (377.395 t if none of those days had one), 8 days ticked.
select reported_by, count(*) as reports,
       sum((select coalesce(sum(value::numeric), 0) from jsonb_each_text(products))) as tons
  from production_reports
 where created_at in ('2026-11-09T18:00:00+03:00', '2026-11-10T18:00:00+03:00', '2026-11-11T18:00:00+03:00',
                      '2026-11-12T18:00:00+03:00', '2026-11-13T18:00:00+03:00', '2026-11-14T18:00:00+03:00',
                      '2026-11-15T18:00:00+03:00', '2026-11-16T18:00:00+03:00')
 group by 1;
