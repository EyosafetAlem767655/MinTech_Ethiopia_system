-- Only PP bag damage photos are uploaded. Everything else keeps a Telegram id.
--
-- The rule was already meant to hold, and kept not holding: the allow-list in
-- the webhook named the flows that skipped the upload, so every new flow
-- defaulted to storing and had to be remembered. It was missed twice — most
-- recently by the daily sales report, which filled the bucket with payment
-- summaries. The list is now inverted in code; these columns are what the
-- remaining paths need to write into.
--
-- A Telegram file id is not a uuid, and these columns are uuid with a foreign
-- key to stored_files, so each gains a SIBLING rather than changing type. Old
-- rows keep their uuids, new rows carry Telegram ids, and readers concatenate
-- the two (see imageRefs in src/lib/images.ts). Same shape as migration 0023.

/* ── The tool / purchase request photo ────────────────────────────────────── */

alter table purchase_requests
  add column if not exists tg_file_id text;

/* ── The three free-text captures ─────────────────────────────────────────── */

alter table daily_reports
  add column if not exists tg_file_ids text[] not null default '{}';

alter table material_counts
  add column if not exists tg_file_ids text[] not null default '{}';

alter table hr_reports
  add column if not exists tg_file_ids text[] not null default '{}';
