-- PP bag damage per pile, daily bag usage, and the whiteness quality check.

/* ──────────────── 1. Damage: one entry per photographed pile ──────────────── */

-- The damage report moved from daily to weekly, and from "a reason and a total"
-- to a line per pile. That matters for the AI check more than for the record:
-- previously a photo and a quantity were only loosely associated, so the model
-- was asked "does this look like damage?" — now it can be asked whether THIS
-- pile plausibly holds THIS many bags of THIS kind, which is a question with a
-- real answer.
create table if not exists pp_bag_damage_items (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references pp_bag_damage_reports(id) on delete cascade,
  position   integer not null default 0,
  -- One of the six bag kinds, spelled as bagLedgerKey does: 'kg25:Yellow'.
  ledger_key text not null,
  quantity   integer not null,
  file_id    uuid references stored_files(id) on delete set null,
  -- The model's verdict on THIS pile against THIS claim.
  ai         jsonb,
  created_at timestamptz not null default now()
);
create index if not exists pp_bag_damage_items_report_idx on pp_bag_damage_items (report_id, position);

-- The report keeps `quantity` as the sum of its items so every existing reader
-- (the brief, the metrics, the exception list) keeps working unchanged.

/* ───────────────────────── 2. PP bags used, daily ─────────────────────────── */

-- What production actually consumed. Deliberately NOT a source for the stock
-- reconciliation: the Store Issue Voucher already records bags leaving the
-- store, and counting both would subtract the same bags twice and turn every
-- month into a phantom shortfall. This is production's own record, and the two
-- figures sitting side by side is the useful part.
create table if not exists pp_bag_usage (
  id          uuid primary key default gen_random_uuid(),
  date_label  text not null unique,        -- 'YYYY-MM-DD' in EAT, one row per day
  date        timestamptz not null,
  reported_by text not null,
  source      text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pp_bag_usage_date_idx on pp_bag_usage (date desc);

create table if not exists pp_bag_usage_items (
  id           uuid primary key default gen_random_uuid(),
  usage_id     uuid not null references pp_bag_usage(id) on delete cascade,
  position     integer not null default 0,
  ledger_key   text not null,              -- 'kg25:Yellow'
  reference_no text,
  quantity     numeric(14,3) not null,
  created_at   timestamptz not null default now()
);
create index if not exists pp_bag_usage_items_usage_idx on pp_bag_usage_items (usage_id, position);

/* ─────────────────── 3. Whiteness quality check (production) ──────────────── */

-- Four checks a day, per product, per line. Six readings each.
--
-- `readings` holds TEXT, not numbers, because a slot legitimately carries 'MNT'
-- (down for maintenance), 'outage' (no power) or 'off' as well as a percentage —
-- and those are not zero. A zero would drag the average down and report a line
-- that was switched off as one producing badly.
create table if not exists whiteness_checks (
  id           uuid primary key default gen_random_uuid(),
  date         timestamptz not null,
  date_label   text not null,              -- 'YYYY-MM-DD' in EAT
  quarter      integer not null check (quarter between 1 and 4),
  product_code text not null,
  line         integer not null,
  -- { "wb1": "88.4", "wb2": "MNT", "wb3": "", … }
  readings     jsonb not null default '{}',
  -- Mean of the NUMERIC readings only, divided by how many there were. Null when
  -- none were numeric — which is a different fact from an average of 0.
  avg          numeric(6,2),
  reported_by  text not null,
  source       text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One reading set per quarter per product per line. A correction replaces the
  -- reading it corrects rather than creating a second one the weekly average
  -- would silently count twice.
  unique (date_label, quarter, product_code, line)
);
create index if not exists whiteness_checks_date_idx    on whiteness_checks (date desc);
create index if not exists whiteness_checks_product_idx on whiteness_checks (product_code, date desc);
