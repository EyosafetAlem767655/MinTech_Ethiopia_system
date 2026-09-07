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
alter table sales_scan_jobs
  alter column photo_file_ids type text[] using photo_file_ids::text[];

/* ──────────────── 2. Telegram ids alongside the stored-file ids ────────────── */

-- A NEW column rather than a widened one. `photo_file_ids` is uuid[] and is read
-- by the recycle bin (deleted_submissions.photo_ids), the September archive and
-- both storage purges — all of which join it against stored_files and would
-- break on a value that is not a uuid.
--
-- So the two live side by side: old rows keep their uuids, new rows carry
-- Telegram ids, and readers concatenate the two before loading. A row has one or
-- the other, never both.
alter table sales_receipts          add column if not exists tg_file_ids text[] not null default '{}';
alter table goods_receiving_vouchers add column if not exists tg_file_ids text[] not null default '{}';
alter table store_issue_vouchers     add column if not exists tg_file_ids text[] not null default '{}';
