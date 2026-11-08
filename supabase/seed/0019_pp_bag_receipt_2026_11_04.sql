-- The PP bag delivery of 4 Nov 2026: 42,500 pieces of 25KG White, Ethio-India.
--
-- The daily count rose from 35,533 to 78,033 that day with no delivery filed, so
-- the stock check expected 35,533 and showed a gap of +42,500. Recorded the way
-- the 🧺 PP bag receipt records one, so the stock check and the monthly report
-- both read it. No count is changed.
--
-- Re-runnable: it replaces its own row.

begin;

delete from pp_bag_purchases where supplier = 'Ethio-India (entered by hand, 4 Nov 2026)';

insert into pp_bag_purchases (date, bags, supplier, reported_by, filed_by_dept, source)
values (
  '2026-11-04T00:00:00Z',
  '{"kg25": {"White@ethio-india": 42500}}'::jsonb,
  'Ethio-India (entered by hand, 4 Nov 2026)',
  'Owner (entered by hand)',
  'asset',
  'app'
);

commit;

-- Check: one row, 42,500.
select date, bags, reported_by from pp_bag_purchases where supplier = 'Ethio-India (entered by hand, 4 Nov 2026)';
