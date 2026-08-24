-- Finance, rebuilt around the three things the department actually does:
-- tool purchase reports, the monthly asset report, and chasing WHT receipt holders.
--
-- The old module (invoices / payments / receivables aging) is gone. It had no
-- writer: nothing created an invoice except an LLM misclassification, and the
-- endpoint that sent payment reminders had no caller anywhere in the UI.

/* ─────────────────────────── 1. Tool purchase report ─────────────────────── */

-- One row per BATCH. A batch is one purchase event that may cover several tools,
-- and `sr_no` is the number written on the paper — shared by every item in it.
--
-- The money lives here rather than on the item: the purchaser is asked for one
-- total at the end, so per-item cost is genuinely not known for a multi-item
-- batch and must not be invented by dividing.
create table if not exists finance_purchase_batches (
  id            uuid primary key default gen_random_uuid(),
  sr_no         integer not null unique,
  date          timestamptz not null default now(),
  supplier      text,
  cost_center   text,
  purchaser     text,
  currency      text not null default 'ETB' check (currency in ('ETB', 'USD')),
  total_amount  numeric(14,2),
  reported_by   text not null,
  photo_file_ids uuid[] not null default '{}',
  -- Gemini's reading of the receipt plus the cross-check against the typed
  -- total. Same shape as sales_receipts.receipt_check.
  receipt_check jsonb,
  source        text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists finance_purchase_batches_date_idx on finance_purchase_batches (date desc);
create index if not exists finance_purchase_batches_sr_idx   on finance_purchase_batches (sr_no desc);

create table if not exists finance_purchase_items (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references finance_purchase_batches(id) on delete cascade,
  position    integer not null default 0,
  description text not null,
  uom         text check (uom in ('pcs', 'pak')),
  quantity    numeric(14,3),
  created_at  timestamptz not null default now()
);
create index if not exists finance_purchase_items_batch_idx on finance_purchase_items (batch_id, position);

-- Allocates the next batch number atomically.
--
-- max(sr_no)+1 read in application code races: two purchasers submitting in the
-- same second both read the same max and one insert dies on the unique index.
-- A sequence hands out distinct numbers without any locking.
create sequence if not exists finance_purchase_sr_seq as integer start 1;

/* ─────────────────────── 2. Monthly base balance (asset) ─────────────────── */

-- The opening balance of a month, counted by asset management three days before
-- the previous month ends. `month` is the month it OPENS: '2026-06' is the
-- balance June starts with, collected in late May.
create table if not exists monthly_base_balances (
  id            uuid primary key default gen_random_uuid(),
  month         text not null unique,          -- 'YYYY-MM'
  products      jsonb not null default '{}',   -- { ETL9: tons, … } finished brands
  raw_materials jsonb not null default '{}',   -- { Dolomite: t, "Lime Stone": t, Talc: t }
  bags          jsonb not null default '{}',   -- { kg25: pieces, kg40: pieces }
  reported_by   text not null,
  source        text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

/* ───────────────────────── 3. Monthly price list (finance) ───────────────── */

-- Prices are pinned to the month they value, not to "now".
--
-- A single standing price list would rewrite history: editing a price in August
-- would silently change June's closing stock net worth. Reopening a month must
-- always reproduce the same figures, so each month carries its own prices and
-- its own USD rate.
create table if not exists monthly_price_lists (
  id          uuid primary key default gen_random_uuid(),
  month       text not null unique,          -- 'YYYY-MM'
  prices      jsonb not null default '{}',   -- { ETL9: etb, Dolomite: etb, kg25: etb, … }
  usd_rate    numeric(14,4),                 -- ETB per 1 USD, for the dual purchase total
  reported_by text not null,
  source      text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

/* ─────────────────── 4. Daily raw-material issue (asset mgmt) ────────────── */

-- What production consumed today. One row per day, upserted, because two people
-- reporting the same day must not produce two numbers nothing can reconcile —
-- the same rule daily_ops_reports follows.
create table if not exists material_issues (
  id          uuid primary key default gen_random_uuid(),
  date_label  text not null unique,          -- 'YYYY-MM-DD' in EAT
  date        timestamptz not null,
  materials   jsonb not null default '{}',   -- { Dolomite: t, "Lime Stone": t, Talc: t }
  bags        jsonb not null default '{}',   -- { kg25: pieces, kg40: pieces }
  reported_by text not null,
  source      text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists material_issues_date_idx on material_issues (date desc);

/* ────────────────────────── 5. PP bag purchases (finance) ────────────────── */

-- Bags bought during the month. Kept apart from raw_material_receipts because
-- bags are counted in pieces, not tonnes, and are bought by finance rather than
-- received against a supplier delivery note.
create table if not exists pp_bag_purchases (
  id             uuid primary key default gen_random_uuid(),
  date           timestamptz not null default now(),
  bags           jsonb not null default '{}',   -- { kg25: pieces, kg40: pieces }
  supplier       text,
  currency       text not null default 'ETB' check (currency in ('ETB', 'USD')),
  total_amount   numeric(14,2),
  reported_by    text not null,
  photo_file_ids uuid[] not null default '{}',
  receipt_check  jsonb,
  source         text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pp_bag_purchases_date_idx on pp_bag_purchases (date desc);

/* ──────────────────── 6. WHT receipt holders + SMS chasing ───────────────── */

-- A customer who owes us a 3% withholding receipt. They are chased by SMS once a
-- day until someone marks the receipt received.
create table if not exists wht_holders (
  id            uuid primary key default gen_random_uuid(),
  company       text not null,
  phone         text not null,
  description   text,
  status        text not null default 'pending' check (status in ('pending', 'received', 'cancelled')),
  registered_by text not null,
  resolved_by   text,
  resolved_at   timestamptz,
  source        text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists wht_holders_status_idx  on wht_holders (status);
create index if not exists wht_holders_created_idx on wht_holders (created_at desc);

-- One row per holder per day.
--
-- The unique constraint IS the once-a-day guarantee. A cron that fires twice, a
-- retry after a timeout, or two overlapping invocations all collide on the
-- insert instead of sending a second message — the same claim-before-acting
-- pattern telegram_updates uses to stop redelivery loops. Claim the day FIRST,
-- then send; a failed send is recorded with ok=false rather than deleted, so a
-- broken gateway cannot turn into a flood of retries.
create table if not exists wht_sms_log (
  id         uuid primary key default gen_random_uuid(),
  holder_id  uuid not null references wht_holders(id) on delete cascade,
  sent_on    date not null,
  phone      text not null,
  ok         boolean not null default false,
  status     integer,
  error      text,
  created_at timestamptz not null default now(),
  unique (holder_id, sent_on)
);
create index if not exists wht_sms_log_holder_idx on wht_sms_log (holder_id, sent_on desc);
