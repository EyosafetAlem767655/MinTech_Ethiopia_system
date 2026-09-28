-- The daily raw-material report: received, issued and counted, per day.
--
-- Replaces the per-TRUCK intake report (raw_material_receipts), which recorded
-- a supplier, a delivery note, a truck plate and an M.R.V number for one load.
-- What the plant needs recorded is one DAY: what came in, what went to
-- production, and what is left on the ground — for the three materials finance
-- already accounts in (Dolomite, Lime Stone, Talc). Asset management used to
-- report Kuni, Chips and Guji separately and finance rolled them into Dolomite;
-- now one vocabulary serves both.
--
-- raw_material_receipts is NOT dropped. Its rows are the only record of every
-- load received before today, they still feed closed monthly reports, and they
-- stay readable and deletable under Settings -> Submissions.
--
-- One row per day, upserted on date_label exactly as daily_ops_reports is: a
-- day filed twice is a correction, not a second reading.

create table if not exists raw_material_daily (
  id          uuid primary key default gen_random_uuid(),
  date        timestamptz not null,
  date_label  text not null unique,          -- 'YYYY-MM-DD' in EAT
  -- { "Dolomite": 12.5, "Lime Stone": 0, "Talc": 4 } — tonnes, three keys each.
  received    jsonb not null default '{}',
  issued      jsonb not null default '{}',   -- consumed by production that day
  stock       jsonb not null default '{}',   -- counted on the ground, a LEVEL
  reported_by text not null,
  source      text not null default 'telegram' check (source in ('telegram','app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists raw_material_daily_date_idx    on raw_material_daily (date desc);
create index if not exists raw_material_daily_created_idx on raw_material_daily (created_at desc);

-- Same posture as every other table here: no Data API, no policies. See
-- 0031_data_api_lockdown.sql for why this is load-bearing rather than ceremony.
alter table raw_material_daily enable row level security;
alter table raw_material_daily force row level security;
