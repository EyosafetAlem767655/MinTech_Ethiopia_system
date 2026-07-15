-- MinTech Ethiopia — initial Postgres schema (migrated from MongoDB Atlas).
--
-- Conventions:
--   * snake_case names; uuid primary keys (the app already treats every id as an
--     opaque string, so uuid is a drop-in for Mongo's ObjectId at the TS boundary).
--   * timestamptz everywhere — Mongo stored UTC Dates.
--   * created_at / updated_at on every table, mirroring Mongoose { timestamps: true }.
--   * Mongo Schema.Types.Mixed  -> jsonb
--   * Mongo arrays of strings   -> text[]
--
-- Fresh start: no data is migrated from MongoDB, so ids are new uuids only.

create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- Keeps updated_at honest without the app having to remember.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

/* ─────────────────────────────── Files ─────────────────────────────── */
-- The bytes now live in Supabase Storage (bucket: mintech-files).
-- This table holds only metadata + the object path.

create table stored_files (
  id            uuid primary key default gen_random_uuid(),
  storage_path  text not null unique,
  content_type  text not null,
  filename      text,
  kind          text,              -- claim_photo | lot_photo | receipt | purchase_request | disposal | raw_material_photo | telegram_upload
  phash         text,              -- 64-char binary string from src/lib/phash.ts
  exif          jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index stored_files_phash_idx on stored_files (phash) where phash is not null;
create index stored_files_kind_idx  on stored_files (kind);

/* ──────────────────────── M1: bag control ──────────────────────────── */

-- lot_code was generated from countDocuments()+1, which races and reuses
-- numbers after a delete. A sequence makes the database the arbiter.
create sequence bag_lot_code_seq;

create table bag_lots (
  id             uuid primary key default gen_random_uuid(),
  lot_code       text not null unique,
  supplier       text not null,
  bag_type       text not null,
  quantity       integer not null,
  delivery_note  text not null,
  registered_by  text,
  handlers       text[] not null default '{}',
  photo_ids      uuid[] not null default '{}',
  received_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- NOTE: the embedded `balance` sub-document is deliberately NOT a column.
-- It is derived — see v_lot_balances at the bottom of this file.

create table bag_events (
  id         uuid primary key default gen_random_uuid(),
  lot_id     uuid not null references bag_lots(id) on delete cascade,
  type       text not null check (type in ('filled','stock_count','adjustment')),
  quantity   integer not null,
  by_user    text,
  shift      text,
  note       text,
  date       timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bag_events_lot_idx      on bag_events (lot_id);
create index bag_events_lot_type_idx on bag_events (lot_id, type, date desc);

create table damage_claims (
  id                     uuid primary key default gen_random_uuid(),
  lot_id                 uuid references bag_lots(id) on delete set null,
  quantity               integer not null,
  source                 text not null check (source in ('app','telegram')),
  worker                 text not null,
  shift                  text,
  gps_lat                double precision,
  gps_lng                double precision,
  device_id              text,
  captured_at            timestamptz,
  flags                  text[] not null default '{}',
  status                 text not null default 'pending'
                           check (status in ('pending','cosign_required','verified','rejected')),
  trust_score            integer,
  ai_counted_bags        integer,
  cosigned_by            text,
  reviewed_by            text,
  reviewed_at            timestamptz,
  -- disposal{} flattened out of the sub-document
  disposal_action        text check (disposal_action in ('returned_to_supplier','destroyed','sold_as_scrap')),
  disposal_amount        numeric(14,2),
  disposal_photo_file_id uuid references stored_files(id) on delete set null,
  disposal_recorded_by   text,
  disposal_recorded_at   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index damage_claims_lot_idx     on damage_claims (lot_id);
create index damage_claims_status_idx  on damage_claims (status);
create index damage_claims_created_idx on damage_claims (created_at desc);
create index damage_claims_flags_idx   on damage_claims using gin (flags);

-- Was DamageClaim.photos[] — a subdocument array. As a real table the
-- "which claim owns this photo?" lookup in claims.ts becomes an indexed FK
-- probe instead of a nested-array scan.
create table claim_photos (
  id                    uuid primary key default gen_random_uuid(),
  claim_id              uuid not null references damage_claims(id) on delete cascade,
  file_id               uuid references stored_files(id) on delete set null,
  phash                 text,
  duplicate_of_claim_id uuid references damage_claims(id) on delete set null,
  ai                    jsonb,   -- { bag_visible, matches_bag_type, damage_visible, damage_severity, suspicious, suspicion_reasons[], notes, aiCountedBags }
  exif_check            jsonb,   -- { hasExif, issues[] }
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index claim_photos_claim_idx on claim_photos (claim_id);
create index claim_photos_file_idx  on claim_photos (file_id);

/* ─────────────────── M6: stone gate / M5: production ───────────────── */

create table stone_deliveries (
  id            uuid primary key default gen_random_uuid(),
  truck_plate   text not null,
  supplier      text,
  quarry        text,
  driver_name   text,
  gate_clerk    text,
  loads         integer not null default 1,
  quality_grade text not null default 'good' check (quality_grade in ('good','fair','dark/weathered')),
  photo_file_id uuid references stored_files(id) on delete set null,
  ai_score      jsonb,
  notes         text,
  date          timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index stone_deliveries_date_idx on stone_deliveries (date desc);

create table shift_reports (
  id               uuid primary key default gen_random_uuid(),
  date             timestamptz not null default now(),
  shift            text not null default 'day' check (shift in ('day','night')),
  supervisor       text not null,
  filled_sacks     integer not null,
  -- nullable on purpose: records predating the tons migration have no weight,
  -- and must contribute 0 tons rather than being coerced to a number.
  bag_weight_kg    integer check (bag_weight_kg in (25,40)),
  downtime_minutes integer not null default 0,
  notes            text,
  lot_id           uuid references bag_lots(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index shift_reports_date_idx on shift_reports (date desc);

/* ────────────────── M3: receivables / M4: receipts ─────────────────── */

create table invoices (
  id                              uuid primary key default gen_random_uuid(),
  invoice_number                  text not null,
  client                          text not null,
  client_phone                    text,
  sacks                           integer not null default 0,
  bag_weight_kg                   integer check (bag_weight_kg in (25,40)),
  amount                          numeric(14,2) not null,
  invoiced_at                     timestamptz not null default now(),
  due_date                        timestamptz not null,
  withholding_receipt_received    boolean not null default false,
  withholding_receipt_file_id     uuid references stored_files(id) on delete set null,
  withholding_receipt_received_at timestamptz,
  notes                           text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
-- The app looks invoices up case-insensitively ($regex ^n$ /i); enforce that.
create unique index invoices_number_lower_idx on invoices (lower(invoice_number));
create index invoices_client_idx     on invoices (client);
create index invoices_invoiced_idx   on invoices (invoiced_at desc);
create index invoices_due_idx        on invoices (due_date);

-- Was Invoice.payments[]. Promoting it to a table is what turns three
-- $unwind aggregation pipelines into ordinary GROUP BY queries.
create table payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount     numeric(14,2) not null,
  date       timestamptz not null default now(),
  method     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_invoice_idx on payments (invoice_id);
create index payments_date_idx    on payments (date);

create table invoice_reminders (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  channel    text not null default 'sms',
  to_addr    text,
  sent_at    timestamptz not null default now(),
  status     text,
  created_at timestamptz not null default now()
);
create index invoice_reminders_invoice_idx on invoice_reminders (invoice_id);

create table receipts (
  id                 uuid primary key default gen_random_uuid(),
  vendor             text not null,
  client             text,
  amount             numeric(14,2) not null,
  category           text,
  receipt_date       timestamptz,
  tax_invoice_number text,
  photo_file_id      uuid references stored_files(id) on delete set null,
  submitted_by       text,
  source             text not null default 'telegram' check (source in ('app','telegram')),
  legitimacy         jsonb,
  meta               jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index receipts_date_idx    on receipts (receipt_date desc);
create index receipts_created_idx on receipts (created_at desc);

/* ─────────────────────── M2: purchase requests ─────────────────────── */

create table purchase_requests (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  amount        numeric(14,2) not null,
  requested_by  text not null,
  justification text,
  photo_file_id uuid references stored_files(id) on delete set null,
  source        text not null default 'app' check (source in ('app','telegram')),
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','bought','disregarded','deferred')),
  decided_by    text,
  decided_at    timestamptz,
  legitimacy    jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index purchase_requests_status_idx  on purchase_requests (status);
create index purchase_requests_created_idx on purchase_requests (created_at);

/* ───────────────────── Daily operations report ─────────────────────── */

create table daily_ops_reports (
  id          uuid primary key default gen_random_uuid(),
  date_label  text not null unique,        -- original "31/3/2026"
  date        timestamptz not null,        -- normalized UTC midnight
  reported_by text not null,
  delivered   jsonb not null default '{}',
  received    jsonb not null default '{}',
  stock       jsonb not null default '{}',
  bags        jsonb not null default '{}', -- { kg25: {...}, kg40: {...} }
  raw_text    text,
  source      text not null default 'telegram' check (source in ('telegram','app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index daily_ops_reports_date_idx on daily_ops_reports (date);

/* ──────────────────────── Brief / infrastructure ───────────────────── */

create table briefs (
  id            uuid primary key default gen_random_uuid(),
  date          text not null unique,      -- YYYY-MM-DD, the day covered
  five_lines    text[] not null default '{}',
  exceptions    text[] not null default '{}',
  narrative     text,
  numbers       jsonb,
  sent_telegram boolean not null default false,
  sent_push     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text,
  auth       text,
  label      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

/* ───────────────── Telegram employee directory (bot auth) ──────────── */
-- Field-for-field identical to the Mongo model. The scrypt hashes and the
-- session_epoch revocation semantics must survive this migration unchanged.

create table telegram_users (
  id              uuid primary key default gen_random_uuid(),
  full_name       text not null,
  full_name_key   text not null unique,   -- NFKC + lowercase + collapsed spaces; the login key
  positions       text[] not null default '{}',
  password_hash   text not null,          -- scrypt$N$salt$hash
  active          boolean not null default true,
  session_epoch   integer not null default 1,
  chat_id         text,
  logged_in       boolean not null default false,
  last_login_at   timestamptz,
  last_seen_at    timestamptz,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  note            text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index telegram_users_active_idx  on telegram_users (active);
create index telegram_users_chat_idx    on telegram_users (chat_id);

create table telegram_sessions (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            text not null unique,
  user_name          text,
  mode               text not null default 'unknown',
  state              text not null default 'idle',
  auth               jsonb,
  external           jsonb,
  login_name         text,
  login_attempts     integer not null default 0,
  login_locked_until timestamptz,
  capture            jsonb,
  draft              jsonb,
  history            jsonb not null default '[]',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

/* ───────────────── Free-form reports submitted by role ─────────────── */

create table daily_reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references telegram_users(id) on delete set null,
  full_name      text not null,
  positions      text[] not null default '{}',
  date_key       text not null,            -- YYYY-MM-DD in EAT
  text           text not null,
  photo_file_ids uuid[] not null default '{}',
  source         text not null default 'telegram' check (source in ('telegram','app')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index daily_reports_datekey_idx on daily_reports (date_key);
create index daily_reports_user_day_idx on daily_reports (user_id, date_key);

create table hr_reports (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references telegram_users(id) on delete set null,
  full_name      text not null,
  kind           text not null check (kind in ('customer_contact','price_adjustment','employee_relations')),
  text           text not null,
  photo_file_ids uuid[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index hr_reports_kind_idx on hr_reports (kind);

create table material_counts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references telegram_users(id) on delete set null,
  counted_by     text not null,
  date_key       text not null,
  raw_text       text not null,
  photo_file_ids uuid[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index material_counts_datekey_idx on material_counts (date_key);

/* ──────────────────── Bot audit trail (webapp feed) ────────────────── */

create table bot_activity (
  id         uuid primary key default gen_random_uuid(),
  chat_id    text not null,
  actor      text not null default 'Unknown',
  user_id    uuid references telegram_users(id) on delete set null,
  positions  text[] not null default '{}',
  audience   text not null default 'unknown' check (audience in ('internal','external','unknown')),
  action     text not null,
  detail     text,
  ok         boolean not null default true,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index bot_activity_created_idx on bot_activity (created_at desc);
create index bot_activity_chat_idx    on bot_activity (chat_id);
create index bot_activity_action_idx  on bot_activity (action);

/* ───────────────────────── updated_at triggers ─────────────────────── */

do $$
declare t text;
begin
  foreach t in array array[
    'stored_files','bag_lots','bag_events','damage_claims','claim_photos',
    'stone_deliveries','shift_reports','invoices','payments','receipts',
    'purchase_requests','daily_ops_reports','briefs','push_subscriptions',
    'telegram_users','telegram_sessions','daily_reports','hr_reports','material_counts'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

/* ────────────────────────── Derived lot balances ───────────────────── */
-- Replaces recomputeLotBalances(), which was an N+1 loop writing an embedded
-- sub-document from five different write paths — and silently went stale if any
-- of them forgot to call it. Here the balance simply cannot be stale.

create view v_lot_balances as
select
  l.id        as lot_id,
  l.lot_code,
  l.supplier,
  l.quantity  as received,
  coalesce(f.filled, 0)            as filled,
  coalesce(d.damaged_verified, 0)  as damaged_verified,
  coalesce(d.damaged_pending, 0)   as damaged_pending,
  coalesce(d.disposed, 0)          as disposed,
  coalesce(sc.qty, l.quantity - coalesce(f.filled,0) - coalesce(d.damaged_verified,0)) as in_stock,
  l.quantity
    - coalesce(f.filled,0)
    - coalesce(d.damaged_verified,0)
    - coalesce(sc.qty, l.quantity - coalesce(f.filled,0) - coalesce(d.damaged_verified,0)) as gap
from bag_lots l
left join (
  select lot_id, sum(quantity)::int as filled
  from bag_events where type = 'filled' group by lot_id
) f on f.lot_id = l.id
left join (
  select lot_id,
    coalesce(sum(quantity) filter (where status = 'verified'), 0)::int                      as damaged_verified,
    coalesce(sum(quantity) filter (where status in ('pending','cosign_required')), 0)::int  as damaged_pending,
    coalesce(sum(quantity) filter (where disposal_action is not null), 0)::int              as disposed
  from damage_claims group by lot_id
) d on d.lot_id = l.id
left join lateral (
  select quantity as qty from bag_events
  where lot_id = l.id and type = 'stock_count'
  order by date desc limit 1
) sc on true;

/* ──────────────────────────────── RLS ──────────────────────────────── */
-- This is load-bearing, not ceremony.
--
-- Supabase exposes every table over PostgREST at /rest/v1/<table>, reachable
-- with the PUBLIC publishable key. That is a second door into the data that
-- completely bypasses this app's middleware. Enabling RLS with ZERO policies
-- makes that door deny-all.
--
-- The app connects through the pooler as the `postgres` role, which bypasses
-- RLS — so server-side access is unaffected. Net effect: access is exactly
-- what it is today (server-side only, gated by middleware).
--
-- If you ever add a policy here, you are opening public internet access to
-- that table. Don't, unless that is precisely what you mean.

do $$
declare t text;
begin
  foreach t in array array[
    'stored_files','bag_lots','bag_events','damage_claims','claim_photos',
    'stone_deliveries','shift_reports','invoices','payments','invoice_reminders',
    'receipts','purchase_requests','daily_ops_reports','briefs','push_subscriptions',
    'telegram_users','telegram_sessions','daily_reports','hr_reports','material_counts',
    'bot_activity'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Views inherit the RLS of their base tables, but belt-and-braces: don't grant
-- the anon/authenticated roles anything at all.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on v_lot_balances from anon, authenticated;
