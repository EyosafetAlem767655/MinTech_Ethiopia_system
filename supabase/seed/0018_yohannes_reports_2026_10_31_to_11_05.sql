-- The production reports of 31 Oct to 5 Nov 2026, entered by hand: Yohannes lost
-- his phone and the owner supplied the figures. Everything is filed in his name
-- and on its own day, so those days count as reported by him.
--
--   * "Received" on the sheet is the day's production: every day's stock equals
--     yesterday's stock + production − yesterday's delivered, to the last figure.
--   * 1/11 B.Stock is November's beginning balance (products, raw material, bags).
--   * The 31/10 raw material report is kept as a record. Raw material used is
--     worked out from production, so its Issue and Stock change no calculation.
--   * The 24/10 bag balance is not here: it equals the 23/10 count already in.
--   * Bags are counts only. Nobody filed the 2,000 + 2,000 used on 3/11 or the
--     42,500 received on 4/11, so the bag check shows those as gaps.
--
-- Re-runnable: it removes its own production and activity rows first. A day
-- that already has a production report keeps it, so nothing is counted twice.

begin;

/* Daily stock, delivered and bags: merged into the day, as the bot does. */
insert into daily_ops_reports (date_label, date, reported_by, delivered, stock, bags, raw_text, source, created_at)
select v.label, v.day, coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes'), v.delivered, v.stock, v.bags,
       'Entered by hand (phone lost)', 'app', v.day + interval '15 hours'
  from (values
  ('31/10/2026', '2026-10-31T00:00:00Z'::timestamptz, '{"ETL9":7,"5EL":5,"EC90":10}'::jsonb, '{}'::jsonb, '{}'::jsonb),
  ('1/11/2026', '2026-11-01T00:00:00Z'::timestamptz, '{}'::jsonb, '{"ETL15":79.04,"ETL9":1281.5,"ETL6":76.92,"5EL":99.945,"2EL":430.47,"W2EL":0.375,"3EL":343.325,"EC15":232.975,"EC90":134.6,"Talk":508.275}'::jsonb, '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":22557,"Yellow@ethio-india":1000,"White@ethio-india":35533},"kg40":{"Green@great-wall":8100,"Colorless@great-wall":74100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('2/11/2026', '2026-11-02T00:00:00Z'::timestamptz, '{"ETL9":13,"EC90":17}'::jsonb, '{"ETL15":79.04,"ETL9":1281.5,"ETL6":76.92,"5EL":99.945,"2EL":448.095,"W2EL":0.375,"3EL":343.325,"EC15":232.975,"EC90":155.92,"Talk":508.275}'::jsonb, '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":22557,"Yellow@ethio-india":1000,"White@ethio-india":35533},"kg40":{"Green@great-wall":8100,"Colorless@great-wall":74100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('3/11/2026', '2026-11-03T00:00:00Z'::timestamptz, '{"ETL9":16,"5EL":2,"2EL":21,"3EL":12.25,"EC90":18.32}'::jsonb, '{"ETL15":79.04,"ETL9":1268.5,"ETL6":76.92,"5EL":99.945,"2EL":464.72,"W2EL":0.375,"3EL":343.325,"EC15":232.975,"EC90":161.52,"Talk":508.275}'::jsonb, '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":35533},"kg40":{"Green@great-wall":8100,"Colorless@great-wall":72100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('4/11/2026', '2026-11-04T00:00:00Z'::timestamptz, '{"ETL9":45,"2EL":20,"EC90":5}'::jsonb, '{"ETL15":79.04,"ETL9":1252.5,"ETL6":76.92,"5EL":97.945,"2EL":458.72,"W2EL":0.375,"3EL":331.075,"EC15":232.975,"EC90":163.2,"Talk":508.275}'::jsonb, '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":8100,"Colorless@great-wall":72100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb),
  ('5/11/2026', '2026-11-05T00:00:00Z'::timestamptz, '{}'::jsonb, '{"ETL15":79.04,"ETL9":1207.5,"ETL6":76.92,"5EL":97.945,"2EL":455.27,"W2EL":0.375,"3EL":331.075,"EC15":232.975,"EC90":179,"Talk":508.275}'::jsonb, '{"kg25":{"Yellow@great-wall":240,"Beige@great-wall":10350,"Colorless@great-wall":20557,"Yellow@ethio-india":1000,"White@ethio-india":78033},"kg40":{"Green@great-wall":8100,"Colorless@great-wall":72100,"Beige@ethio-india":63,"Yellow@ethio-india":47500}}'::jsonb)
  ) as v(label, day, delivered, stock, bags)
on conflict (date_label) do update set
  delivered = daily_ops_reports.delivered || excluded.delivered,
  stock = daily_ops_reports.stock || excluded.stock,
  bags = case when excluded.bags = '{}'::jsonb then daily_ops_reports.bags else jsonb_build_object(
    'kg25', coalesce(daily_ops_reports.bags -> 'kg25', '{}'::jsonb) || coalesce(excluded.bags -> 'kg25', '{}'::jsonb),
    'kg40', coalesce(daily_ops_reports.bags -> 'kg40', '{}'::jsonb) || coalesce(excluded.bags -> 'kg40', '{}'::jsonb)
  ) end,
  updated_at = now();

/* Production: what raw material used is worked out from. */
delete from production_reports where fgr_no = 'manual-2026-11-phone-lost';

insert into production_reports (date, fgr_no, reported_by, products, source, created_at)
select (v.day || 'T00:00:00Z')::timestamptz, 'manual-2026-11-phone-lost', coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes'), v.products, 'app',
       (v.day || 'T18:00:00+03:00')::timestamptz
  from (values
  ('2026-10-31', '{}'::jsonb),
  ('2026-11-01', '{"2EL":10.75,"EC90":15.2}'::jsonb),
  ('2026-11-02', '{"2EL":17.625,"EC90":21.32}'::jsonb),
  ('2026-11-03', '{"2EL":16.625,"EC90":22.6}'::jsonb),
  ('2026-11-04', '{"2EL":15,"EC90":20}'::jsonb),
  ('2026-11-05', '{"2EL":16.55,"EC90":20.8}'::jsonb)
  ) as v(day, products)
 where not exists (
   select 1 from production_reports p
    where (p.date at time zone 'Africa/Addis_Ababa')::date = (v.day)::date
 );

/* November's beginning balance: 1/11 B.Stock. */
insert into monthly_base_balances (month, products, raw_materials, bags, reported_by, source)
values ('2026-11', '{"ETL15":79.04,"ETL9":1281.5,"ETL6":76.92,"5EL":99.945,"2EL":419.72,"W2EL":0.375,"3EL":343.325,"EC15":232.975,"EC90":119.4,"Talk":508.275}'::jsonb, '{"Dolomite":5759.90255,"Lime Stone":1042.627,"Talc":301.68475}'::jsonb, '{"kg25:Yellow@great-wall":240,"kg25:Beige@great-wall":10350,"kg25:Colorless@great-wall":22557,"kg25:Yellow@ethio-india":1000,"kg25:White@ethio-india":35533,"kg40:Green@great-wall":8100,"kg40:Colorless@great-wall":74100,"kg40:Beige@ethio-india":63,"kg40:Yellow@ethio-india":47500}'::jsonb, coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes'), 'app')
on conflict (month) do update set
  products = excluded.products,
  raw_materials = excluded.raw_materials,
  bags = excluded.bags,
  reported_by = excluded.reported_by,
  updated_at = now();

/* The 31/10 raw material report, as a record. */
insert into raw_material_daily (date, date_label, received, issued, stock, reported_by, source, created_at)
values ('2026-10-31T00:00:00Z', '2026-10-31', '{"Dolomite":0,"Lime Stone":0,"Talc":0}'::jsonb, '{"Dolomite":1016.694,"Lime Stone":126.33075,"Talc":0}'::jsonb, '{"Dolomite":5759.90255,"Lime Stone":1042.627,"Talc":301.68475}'::jsonb,
        coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes'), 'app', '2026-10-31T18:00:00+03:00')
on conflict (date_label) do update set
  issued = excluded.issued,
  stock = excluded.stock,
  updated_at = now();

/* What ticks him on the attendance calendar. */
delete from bot_activity where detail = 'Entered by hand (phone lost)';

insert into bot_activity (chat_id, actor, user_id, positions, audience, action, detail, created_at)
select coalesce(u.chat_id, 'manual'), w.name, u.id, coalesce(u.positions, '{}'), 'internal', 'submission',
       'Entered by hand (phone lost)', (d || 'T18:00:00+03:00')::timestamptz
  from (select coalesce(
  (select full_name from telegram_users
    where full_name ilike 'yohannes%' and archived_at is null
    order by ('prod_daily' = any(positions)) desc, full_name
    limit 1),
  'Yohannes') as name) w
  left join telegram_users u on u.full_name = w.name
 cross join unnest(array['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']) as d;

commit;

-- Check: the name used (is it right?), then 5 days with tons plus one empty, 6 ticks.
select reported_by, count(*) as reports, sum((select coalesce(sum(value::numeric), 0) from jsonb_each_text(products))) as tons
  from production_reports where fgr_no = 'manual-2026-11-phone-lost' group by 1;
select count(*) as days_ticked from bot_activity where detail = 'Entered by hand (phone lost)';
select month, reported_by from monthly_base_balances where month = '2026-11';
