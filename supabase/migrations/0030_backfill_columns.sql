-- Every optional column the code expects, re-added. Safe to run any number of times.
--
-- This exists because of a real, quiet loss. `purchase_requests.tg_file_id`
-- arrives in 0025 — and 0025 was never applied. `insertRow` did exactly what it
-- was built to do (the request was saved, the photo reference dropped, the drift
-- logged as `schema_column_missing`), so nothing broke loudly and every tool
-- request filed since has lost its photograph.
--
-- The fix is not "find which migration half-applied". It is one file that states
-- what the running code needs, guarded so it can be run again whenever the
-- schema check in Settings → Errors says something is missing. Every statement
-- is `add column if not exists`: a column already there is left exactly as it is,
-- including its data.

/* ── The photo references (0023 / 0025) ───────────────────────────────────── */

-- The one that is actually missing right now.
alter table purchase_requests
  add column if not exists tg_file_id text;

alter table daily_reports    add column if not exists tg_file_ids text[] not null default '{}';
alter table material_counts  add column if not exists tg_file_ids text[] not null default '{}';
alter table hr_reports       add column if not exists tg_file_ids text[] not null default '{}';

alter table goods_receiving_vouchers add column if not exists tg_file_ids text[] not null default '{}';
alter table store_issue_vouchers     add column if not exists tg_file_ids text[] not null default '{}';

/* ── The guided purchase request's own fields (0028) ──────────────────────── */

alter table purchase_requests
  add column if not exists description text,
  add column if not exists unit        text,
  add column if not exists department  text,
  add column if not exists notes       text;
