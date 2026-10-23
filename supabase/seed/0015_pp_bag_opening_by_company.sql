-- PP bag stock by company — the opening count of 23 Oct 2026.
--
-- From this count on, PP bags are kept per manufacturer (Great Wall Packaging,
-- Ethio-India). It is written as the day's bag count, so it shows under
-- Stock on hand as today's closing count, and the stock check and the finance
-- report take it as each company's opening. Tomorrow's count continues from it.
--
-- Nothing is deleted or rewritten: earlier counts keep their figures, and any
-- bag figures already on today's row stay beside these. Safe to run again (it
-- writes the same numbers).

begin;

insert into daily_ops_reports (date_label, date, reported_by, bags, raw_text, source)
values (
  '23/10/2026',
  '2026-10-23T00:00:00Z',
  'Opening count (owner)',
  '{
    "kg25": {
      "Yellow@great-wall": 840,     "White@great-wall": 0,     "Beige@great-wall": 10350, "Colorless@great-wall": 27557,
      "Yellow@ethio-india": 1000,   "White@ethio-india": 35533, "Beige@ethio-india": 0,    "Colorless@ethio-india": 0
    },
    "kg40": {
      "Yellow@great-wall": 0,       "Green@great-wall": 8100,  "Beige@great-wall": 0,     "Colorless@great-wall": 80100,
      "Yellow@ethio-india": 47500,  "Green@ethio-india": 0,    "Beige@ethio-india": 63,   "Colorless@ethio-india": 0
    }
  }'::jsonb,
  'PP bag opening count by company',
  'app'
)
on conflict (date_label) do update set
  bags = jsonb_build_object(
    'kg25', coalesce(daily_ops_reports.bags -> 'kg25', '{}'::jsonb) || (excluded.bags -> 'kg25'),
    'kg40', coalesce(daily_ops_reports.bags -> 'kg40', '{}'::jsonb) || (excluded.bags -> 'kg40')
  ),
  updated_at = now();

commit;

-- Check: today's count, per company.
select date_label, bags from daily_ops_reports where date_label = '23/10/2026';
