-- PP bag damage reporting (Asset Management) + per-employee capability overrides.
--
-- Deliberately separate from `damage_claims`: that table belongs to production's
-- bag-control module, with lot linkage, a co-sign workflow and morning-brief
-- tripwires. Asset management reports spoilage of the PP sacks themselves, which
-- has none of that, and mixing them would corrupt bag-control's own reporting.

create table if not exists pp_bag_damage_reports (
  id          uuid primary key default gen_random_uuid(),
  date        timestamptz not null default now(),
  reason      text not null,
  quantity    integer not null,
  reported_by text not null,
  -- 0-100, scored the same way claims.ts scores a damage claim.
  trust_score integer,
  flags       text[] not null default '{}',
  -- Merged AI verdict, including which provider actually answered.
  ai          jsonb,
  source      text not null default 'telegram' check (source in ('telegram','app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pp_bag_damage_date_idx    on pp_bag_damage_reports (date desc);
create index if not exists pp_bag_damage_created_idx on pp_bag_damage_reports (created_at desc);
create index if not exists pp_bag_damage_flags_idx   on pp_bag_damage_reports using gin (flags);

-- One row per photo.
--
-- `phash` is a COPY of the hash, not a lookup into stored_files. The photo
-- binaries are purged on a retention schedule and `file_id` goes null with them,
-- but the duplicate check has to outlive the image — otherwise re-submitting an
-- old photo becomes undetectable the moment the original is reaped. claim_photos
-- does exactly the same thing for the same reason.
create table if not exists pp_bag_damage_photos (
  id                     uuid primary key default gen_random_uuid(),
  report_id              uuid not null references pp_bag_damage_reports(id) on delete cascade,
  file_id                uuid references stored_files(id) on delete set null,
  phash                  text,
  duplicate_of_report_id uuid references pp_bag_damage_reports(id) on delete set null,
  ai                     jsonb,
  exif_check             jsonb,
  created_at             timestamptz not null default now()
);
create index if not exists pp_bag_damage_photos_report_idx  on pp_bag_damage_photos (report_id);
create index if not exists pp_bag_damage_photos_created_idx on pp_bag_damage_photos (created_at);
create index if not exists pp_bag_damage_photos_phash_idx   on pp_bag_damage_photos (phash)
  where phash is not null;

-- Per-employee bot functionality overrides.
--
-- NULL or empty means "derive from the positions held", which is how every
-- existing user behaves. A non-empty array is an explicit set chosen in the
-- dashboard, letting one person have a subset (or superset) of their role's
-- default buttons without inventing a new position for them.
alter table telegram_users
  add column if not exists capabilities text[];
