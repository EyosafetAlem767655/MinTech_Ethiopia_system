-- Two things nobody was writing down.
--
-- 1. DOWNTIME. Production runs a twelve-hour day; when it stops, the hours and
--    the reason existed only in somebody's memory. Hours rather than a start
--    and end time, because that is how the floor reports it and a shift that
--    stops twice in a day is one figure to them, not two intervals.
--
-- 2. BANK COLLECTIONS. What came in through each bank is on one sheet, once a
--    month, and reached no system at all.

create table if not exists downtime_reports (
  id               uuid primary key default gen_random_uuid(),
  date             timestamptz not null,
  date_label       text not null,                 -- 'YYYY-MM-DD' in EAT
  -- Against a 12-hour day. Checked here as well as in the bot: a 30-hour
  -- stoppage in a 12-hour day is a typo, and one that reached the dashboard
  -- would read as three days lost.
  hours            numeric(4,2) not null check (hours > 0 and hours <= 12),
  reason           text not null check (reason in ('power', 'maintenance', 'raw_material')),
  -- Only meaningful when the reason is maintenance, which the bot enforces by
  -- asking the question only then.
  maintenance_kind text check (maintenance_kind is null
                               or maintenance_kind in ('mechanical', 'electrical', 'both')),
  note             text,
  reported_by      text not null,
  source           text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Deliberately no unique key on the day: a line can stop twice for two
-- different reasons, and collapsing them onto one row would make the second
-- overwrite the first.
create index if not exists downtime_reports_date_idx    on downtime_reports (date desc);
create index if not exists downtime_reports_created_idx on downtime_reports (created_at desc);

create table if not exists bank_collections (
  id          uuid primary key default gen_random_uuid(),
  -- One row per month, upserted. Re-filing a month corrects it rather than
  -- adding a second version nobody can tell apart.
  month       text not null unique,              -- 'YYYY-MM'
  -- { "CBE": 1240000, "Awash": 380500, … } — keys are entries of BANKS in
  -- src/lib/banks.ts, so the sheet, the bot and the dashboard spell them once.
  banks       jsonb not null default '{}',
  total       numeric(16,2),
  -- What the model read off the sheet, kept for the audit trail: a figure that
  -- was machine-read and then corrected should be able to show both.
  extraction  jsonb,
  tg_file_ids text[] not null default '{}',
  reported_by text not null,
  source      text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists bank_collections_month_idx on bank_collections (month desc);

-- Same posture as every other table here: no Data API, no policies.
-- See 0031_data_api_lockdown.sql for why this is load-bearing.
alter table downtime_reports  enable row level security;
alter table downtime_reports  force  row level security;
alter table bank_collections  enable row level security;
alter table bank_collections  force  row level security;
