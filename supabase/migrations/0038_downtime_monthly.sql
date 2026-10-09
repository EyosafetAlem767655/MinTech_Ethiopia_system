-- Downtime becomes a monthly sheet, photographed once a month.
--
-- The stoppages themselves still land in downtime_reports, one row per
-- stoppage, so the Downtime panel and the alert bar are unchanged. What this
-- table adds is the FILING: that a month's sheet was sent at all.
--
-- Without it, a month with no stoppages and a month nobody filed look the same
-- (no rows either way), and the monthly reminder could not tell which one it
-- was looking at. One row per month, upserted: re-filing a month replaces its
-- stoppages and updates this row.

create table if not exists downtime_months (
  id           uuid primary key default gen_random_uuid(),
  month        text not null unique,                 -- 'YYYY-MM'
  stoppages    integer not null default 0,
  total_hours  numeric(7,2) not null default 0,
  -- What the model read off the sheet, for the audit trail: a figure that was
  -- machine-read and then corrected should be able to show both.
  extraction   jsonb,
  tg_file_ids  text[] not null default '{}',
  reported_by  text not null,
  source       text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Same posture as every other table here: no Data API, no policies.
-- See 0031_data_api_lockdown.sql.
alter table downtime_months enable row level security;
alter table downtime_months force  row level security;
