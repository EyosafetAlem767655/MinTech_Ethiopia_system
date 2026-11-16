-- 💸 One payment over several raw-material loads.
--
-- The bot can now put one payment on several loads (each its own amount, or
-- one total split oldest first). It is still saved one row per load, so every
-- load's balance stays a plain sum of its payments; batch_id ties the rows of
-- one payment together, so the dashboard shows it as the single payment it was.
-- Null on a payment made against one load, and on every payment before this.
-- Additive: no existing row or reader changes.

alter table raw_material_credit_payments add column if not exists batch_id uuid;

create index if not exists raw_material_credit_payments_batch_idx
  on raw_material_credit_payments (batch_id) where batch_id is not null;
