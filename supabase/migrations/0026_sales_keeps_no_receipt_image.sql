-- The daily sales report keeps no reference to its own photograph.
--
-- The image was never uploaded — 0023 and 0024 already moved this report off
-- storage and kept only Telegram's file id, which costs nothing to hold. But an
-- id still RESOLVES: /api/files served it back, and the sales panel rendered it,
-- so the receipt appeared on the dashboard. A receipt visible on the webapp
-- reads as a receipt filed on the webapp, which is the opposite of the rule for
-- this report — the ten figures are the record, and the reporter checks them on
-- the edit card before approving, while they are still standing at the till.
--
-- So the reference goes too. Nothing is deleted from the bucket here because
-- nothing of this report was ever in it; this only drops ids that pointed back
-- into Telegram.
--
-- PP bag damage is untouched and still uploads: its perceptual hashes are a
-- three-month duplicate check, and a photo that was never stored can never be
-- matched against a later one. See 0025 and src/lib/storage.ts.

update daily_sales_summaries set tg_file_ids = '{}' where tg_file_ids <> '{}';

-- The column stays. Dropping it would rewrite the table and break the wholesale
-- export in src/lib/archive.ts, and an always-empty text[] costs a byte a row.
comment on column daily_sales_summaries.tg_file_ids is
  'Always empty. The payment summary is read once and never referenced again — see migration 0026.';
