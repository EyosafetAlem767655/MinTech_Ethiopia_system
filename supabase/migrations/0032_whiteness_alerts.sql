-- Remember which whiteness checks have already raised an alarm.
--
-- A check is upserted on (date_label, quarter, product_code, line): filing the
-- same round twice, or correcting one reading of it, rewrites the row. Without
-- somewhere to record that the alarm went out, every one of those rewrites
-- would page every admin and every HR user again about a reading they were told
-- about an hour ago.
--
-- Null means "not alerted yet", which is also what every existing row means:
-- historic checks are not retro-alarmed, and the first below-spec reading filed
-- after this runs is the first anybody hears about.
alter table whiteness_checks
  add column if not exists alerted_at timestamptz;

-- The claim query reads exactly this: rows below spec that nobody has been told
-- about. Partial, because the alerted rows are the overwhelming majority and
-- are never looked for.
create index if not exists whiteness_checks_unalerted_idx
  on whiteness_checks (date desc)
  where alerted_at is null;
