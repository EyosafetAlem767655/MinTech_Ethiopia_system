-- A recycle bin for submissions, and the yearly reset that empties everything.
--
-- Deleting a report from the dashboard used to be final: one typed confirmation
-- and the row, its child rows and its photos were gone. That is the right shape
-- for "remove this permanently" and the wrong one for "this looks like a
-- mistake" — which is what most deletions actually are.
--
-- The row now MOVES here instead. Two stages: delete puts it in the bin, and the
-- bin offers restore or permanent removal.

-- Why a separate table rather than a `deleted_at` column on all 24 tables:
--
-- a soft-delete flag is only as good as the WHERE clause that remembers it, and
-- these tables are read by the brief, the metrics, the monthly finance report,
-- the department panels, the compliance check and the AI chat. One forgotten
-- `and deleted_at is null` and a deleted report keeps counting toward a total
-- with nothing on screen to explain it. Moving the row out means every existing
-- query is correct without being touched.
create table if not exists deleted_submissions (
  id           uuid primary key default gen_random_uuid(),
  -- Registry key from src/lib/submissions.ts, e.g. 'production'.
  collection   text not null,
  source_table text not null,
  -- The original primary key. Restoring re-inserts under the SAME id, so
  -- anything that referenced the row (a photo child, an audit line) still points
  -- at it afterwards.
  row_id       uuid not null,
  -- The whole row, exactly as it was. Restoring reads columns back out of here,
  -- so a column added after the deletion simply comes back null rather than
  -- blocking the restore.
  payload      jsonb not null,
  -- Rows from child tables, keyed by table name: { "pp_bag_damage_photos": [ … ] }.
  -- They are cascaded away by the delete, so they have to be captured here or a
  -- restored report would come back without its photos.
  children     jsonb not null default '{}',
  -- stored_files ids the report referenced. Held so the purge can be told to
  -- leave them alone while the report sits in the bin.
  photo_ids    uuid[] not null default '{}',
  -- One line describing the row, so the bin is readable without unpacking jsonb.
  summary      text,
  deleted_by   text not null default 'Dashboard',
  deleted_at   timestamptz not null default now(),
  -- One bin entry per row. A second delete of the same id is a no-op rather than
  -- a duplicate that restores twice.
  unique (source_table, row_id)
);

create index if not exists deleted_submissions_at_idx   on deleted_submissions (deleted_at desc);
create index if not exists deleted_submissions_coll_idx on deleted_submissions (collection, deleted_at desc);
