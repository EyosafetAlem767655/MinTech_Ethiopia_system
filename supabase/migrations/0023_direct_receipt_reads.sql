-- Receipts stop being uploaded to Supabase Storage.
--
-- A sales receipt, a goods receiving voucher and a store issue voucher are read
-- once and the figures on them are the record. Keeping the megabytes as well was
-- paying storage rent on a photograph nobody opens again, and the bucket was
-- growing by every sale.
--
-- What is kept instead is Telegram's own file id: it stays valid indefinitely,
-- resolves back to the original image on demand, and costs nothing because the
-- bytes never leave Telegram. The image goes straight from the update to the
-- model.

/* ─────────────── 1. The scan job must be able to hold a Telegram id ─────────── */

-- `photo_file_ids` is uuid[] and a Telegram file id is not a uuid, so this is
-- the one column that has to change type rather than gain a sibling. It is a
-- short-lived work queue — a job lives minutes — so there is nothing here worth
-- preserving beyond making the cast valid for anything already queued.
-- Guarded, because 0024 DROPS this table. Without the guard, running the
-- migrations in the wrong order — or re-running this one after 0024 — fails on
-- "relation sales_scan_jobs does not exist" and the rest of the file, which is
-- where the columns everything now writes to live, never runs.
do $$
begin
  if to_regclass('public.sales_scan_jobs') is not null then
    alter table sales_scan_jobs
      alter column photo_file_ids type text[] using photo_file_ids::text[];
  end if;
end $$;

/* ──────────────── 2. Telegram ids alongside the stored-file ids ────────────── */

-- A NEW column rather than a widened one. `photo_file_ids` is uuid[] and is read
-- by the recycle bin (deleted_submissions.photo_ids), the September archive and
-- both storage purges — all of which join it against stored_files and would
-- break on a value that is not a uuid.
--
-- So the two live side by side: old rows keep their uuids, new rows carry
-- Telegram ids, and readers concatenate the two before loading. A row has one or
-- the other, never both.
-- sales_receipts is guarded for the same reason as sales_scan_jobs above: 0024
-- drops it. `add column if not exists` protects against the COLUMN already
-- being there, not against the TABLE being gone — and this statement failing
-- aborts the file, so the two below it, which add the column the voucher
-- inserts actually write to, never run at all. That is not a hypothetical: it
-- is how goods_receiving_vouchers ended up without the column.
do $$
begin
  if to_regclass('public.sales_receipts') is not null then
    alter table sales_receipts add column if not exists tg_file_ids text[] not null default '{}';
  end if;
end $$;

-- These two are permanent; nothing later drops them.
alter table goods_receiving_vouchers add column if not exists tg_file_ids text[] not null default '{}';
alter table store_issue_vouchers     add column if not exists tg_file_ids text[] not null default '{}';
