-- MinTech Ethiopia: daily production, 1-30 July 2026 (the owner's figures).
-- What was produced each day, per product. 31 July is already on file and is
-- not touched.
--
-- 30 days, 2516.97 t in total: ETL9 1217.86, 3EL 369.95, 2EL 466.795, ETL15 320.48, ETL6 50.56, 5EL 91.325.
--
-- Dated at UTC midnight, as the guided production flow writes them. A day that
-- already has a production report is left as it is. Re-runnable: it replaces
-- only its own rows (reported_by = 'historical import', 1-30 July).

begin;

delete from production_reports
 where date >= '2026-07-01T00:00:00Z' and date < '2026-07-31T00:00:00Z'
   and reported_by = 'historical import';

insert into production_reports (date, reported_by, products, source)
select (v.day || 'T00:00:00Z')::timestamptz, 'historical import', v.products, 'app'
  from (values
  -- 1-Jul · 94.2 t
  ('2026-07-01', '{"ETL9": 57.2, "3EL": 37.0}'::jsonb),
  -- 2-Jul · 85.825 t
  ('2026-07-02', '{"ETL9": 41.2, "3EL": 44.625}'::jsonb),
  -- 3-Jul · 90.37 t
  ('2026-07-03', '{"ETL9": 48.12, "3EL": 42.25}'::jsonb),
  -- 4-Jul · 92.875 t
  ('2026-07-04', '{"ETL9": 49.0, "3EL": 43.875}'::jsonb),
  -- 5-Jul · 87.005 t
  ('2026-07-05', '{"ETL9": 53.88, "3EL": 33.125}'::jsonb),
  -- 6-Jul · 87.07 t
  ('2026-07-06', '{"ETL9": 50.2, "2EL": 30.97, "3EL": 5.9}'::jsonb),
  -- 7-Jul · 83.12 t
  ('2026-07-07', '{"ETL9": 45.32, "2EL": 37.8}'::jsonb),
  -- 8-Jul · 70.92 t
  ('2026-07-08', '{"ETL9": 30.52, "2EL": 40.4}'::jsonb),
  -- 9-Jul · 68.625 t
  ('2026-07-09', '{"ETL9": 26.825, "2EL": 41.8}'::jsonb),
  -- 10-Jul · 83.95 t
  ('2026-07-10', '{"ETL9": 40.75, "2EL": 43.2}'::jsonb),
  -- 11-Jul · 82.025 t
  ('2026-07-11', '{"ETL9": 44.5, "2EL": 37.525}'::jsonb),
  -- 12-Jul · 91.6 t
  ('2026-07-12', '{"ETL9": 50.075, "2EL": 41.525}'::jsonb),
  -- 13-Jul · 90.575 t
  ('2026-07-13', '{"ETL9": 51.2, "2EL": 39.375}'::jsonb),
  -- 14-Jul · 86.85 t
  ('2026-07-14', '{"ETL9": 51.4, "2EL": 35.45}'::jsonb),
  -- 15-Jul · 80.44 t
  ('2026-07-15', '{"ETL15": 43.56, "ETL9": 35.88, "2EL": 1.0}'::jsonb),
  -- 16-Jul · 75.12 t
  ('2026-07-16', '{"ETL15": 41.92, "ETL9": 33.2}'::jsonb),
  -- 17-Jul · 72.375 t
  ('2026-07-17', '{"ETL9": 43.0, "ETL6": 1.0, "3EL": 28.375}'::jsonb),
  -- 18-Jul · 83.225 t
  ('2026-07-18', '{"ETL9": 43.6, "3EL": 39.625}'::jsonb),
  -- 19-Jul · 101.145 t
  ('2026-07-19', '{"ETL15": 35.0, "ETL9": 47.32, "ETL6": 1.0, "3EL": 17.825}'::jsonb),
  -- 20-Jul · 90.33 t
  ('2026-07-20', '{"ETL9": 51.955, "3EL": 38.375}'::jsonb),
  -- 21-Jul · 84.025 t
  ('2026-07-21', '{"ETL15": 15.0, "ETL9": 34.675, "ETL6": 1.0, "3EL": 33.35}'::jsonb),
  -- 22-Jul · 101.825 t
  ('2026-07-22', '{"ETL15": 81.8, "ETL9": 14.4, "3EL": 5.625}'::jsonb),
  -- 23-Jul · 115.96 t
  ('2026-07-23', '{"ETL15": 102.4, "ETL9": 13.56}'::jsonb),
  -- 24-Jul · 86.4 t
  ('2026-07-24', '{"ETL15": 0.8, "ETL9": 38.04, "ETL6": 47.56}'::jsonb),
  -- 25-Jul · 27.41 t
  ('2026-07-25', '{"ETL9": 18.16, "5EL": 9.25}'::jsonb),
  -- 26-Jul · 93.9 t
  ('2026-07-26', '{"ETL9": 46.4, "5EL": 47.5}'::jsonb),
  -- 27-Jul · 87.03 t
  ('2026-07-27', '{"ETL9": 41.08, "5EL": 34.575, "2EL": 11.375}'::jsonb),
  -- 28-Jul · 104.82 t
  ('2026-07-28', '{"ETL9": 63.32, "2EL": 41.5}'::jsonb),
  -- 29-Jul · 75.025 t
  ('2026-07-29', '{"ETL9": 36.4, "2EL": 38.625}'::jsonb),
  -- 30-Jul · 42.93 t
  ('2026-07-30', '{"ETL9": 16.68, "2EL": 26.25}'::jsonb)
  ) as v(day, products)
 where not exists (
   select 1 from production_reports p
    where (p.date at time zone 'Africa/Addis_Ababa')::date = (v.day)::date
 );

commit;

-- Check: 30 days in July before the 31st.
select count(*) as days, round(sum((select sum(value::numeric) from jsonb_each_text(products))), 3) as tonnes
  from production_reports
 where date >= '2026-07-01T00:00:00Z' and date < '2026-07-31T00:00:00Z';
