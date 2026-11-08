-- 📋 Sales data manager: a sale can be approved or corrected after it is filed.
--
-- review_status is null until someone reviews the sale, then 'approved' (taken
-- as filed) or 'edited' (corrected through the bot's copyable block). Who and
-- when are kept beside it. Additive: no existing row or reader changes.

alter table sales_invoices add column if not exists review_status text
  check (review_status in ('approved', 'edited'));
alter table sales_invoices add column if not exists reviewed_by text;
alter table sales_invoices add column if not exists reviewed_at timestamptz;
