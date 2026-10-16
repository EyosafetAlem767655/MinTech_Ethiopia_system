-- Two records the plant keeps on paper, in the shape the paper has.
--
-- 1. THE PRODUCTION HOURS REPORT. Once a month, one row per production line:
--    hours and days working, stopped by a power interruption, stopped for
--    mechanical or electrical maintenance, short of raw material, and the
--    month's total (31 days → 744 h). It replaces the one-line-per-stoppage
--    list (downtime_reports, kept for history) because that is not what the
--    sheet records. `downtime_months` stays the "month filed" marker.
--
-- 2. RAW MATERIAL BOUGHT ON CREDIT. A truck of Talc / Kuni / Chips / Guji /
--    Lime Stone arrives, the supplier is owed tonnes × price, and the debt is
--    paid off over time. One row per load, one row per payment against it; what
--    is still owed is derived, never stored, so a correction cannot leave a
--    stale balance behind.

/* ───────────────────── 1. Production hours, per line ─────────────────────── */

create table if not exists production_hours (
  id              uuid primary key default gen_random_uuid(),
  month           text not null,                 -- 'YYYY-MM'
  line            integer not null check (line between 1 and 20),
  -- Hours are kept in MINUTES: the sheet writes h:mm (538:50), and minutes are
  -- exact where decimal hours are not.
  working_minutes integer not null default 0 check (working_minutes >= 0),
  working_days    numeric(5,2) not null default 0,
  power_minutes   integer not null default 0 check (power_minutes >= 0),
  power_days      numeric(5,2) not null default 0,
  mech_minutes    integer not null default 0 check (mech_minutes >= 0),
  mech_days       numeric(5,2) not null default 0,
  elec_minutes    integer not null default 0 check (elec_minutes >= 0),
  elec_days       numeric(5,2) not null default 0,
  raw_minutes     integer not null default 0 check (raw_minutes >= 0),
  raw_days        numeric(5,2) not null default 0,
  total_minutes   integer not null default 0 check (total_minutes >= 0),
  total_days      numeric(5,2) not null default 0,
  reported_by     text not null,
  source          text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (month, line)
);

create index if not exists production_hours_month_idx on production_hours (month desc);

/* ──────────────────── 2. Raw material bought on credit ───────────────────── */

create table if not exists raw_material_credits (
  id              uuid primary key default gen_random_uuid(),
  date            timestamptz not null,
  date_label      text not null,                 -- 'YYYY-MM-DD' in EAT
  supplier        text not null,
  truck_plate     text,
  material        text not null check (material in ('Talc', 'Kuni', 'Chips', 'Guji', 'Lime Stone')),
  tonnes          numeric(12,3) not null check (tonnes > 0),
  price_per_tonne numeric(14,2) not null check (price_per_tonne >= 0),
  -- tonnes × price, computed in code when the load is filed and stored so the
  -- figure owed is exactly the one the person confirmed on the card.
  amount          numeric(16,2) not null check (amount >= 0),
  note            text,
  reported_by     text not null,
  source          text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists raw_material_credits_date_idx     on raw_material_credits (date desc);
create index if not exists raw_material_credits_supplier_idx on raw_material_credits (lower(supplier));

create table if not exists raw_material_credit_payments (
  id          uuid primary key default gen_random_uuid(),
  credit_id   uuid not null references raw_material_credits(id) on delete cascade,
  -- Positive by constraint; a mistake is corrected by deleting the payment,
  -- never by a negative one nobody can add up by eye.
  amount      numeric(16,2) not null check (amount > 0),
  paid_on     date not null default ((now() at time zone 'Africa/Addis_Ababa')::date),
  note        text,
  recorded_by text not null,
  created_at  timestamptz not null default now()
);

create index if not exists raw_material_credit_payments_credit_idx on raw_material_credit_payments (credit_id);

-- Same posture as every other table here: no Data API, no policies.
-- See 0031_data_api_lockdown.sql.
alter table production_hours             enable row level security;
alter table production_hours             force  row level security;
alter table raw_material_credits         enable row level security;
alter table raw_material_credits         force  row level security;
alter table raw_material_credit_payments enable row level security;
alter table raw_material_credit_payments force  row level security;
