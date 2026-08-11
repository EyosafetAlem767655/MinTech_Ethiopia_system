-- Sales receipt scanner: rows extracted from scanned receipts (OCR + Qwen),
-- previewed/edited on Telegram, then processed → exported to Excel → submitted
-- to the dashboard. Matches the company Sales (Cash Sales) report columns.

create table if not exists sales_receipts (
  id             uuid primary key default gen_random_uuid(),
  date           timestamptz not null default now(),
  customer_name  text,
  fs_no          text,
  att_no         text,
  product_ty     text,
  qty            numeric(14,3),
  unit_price     numeric(14,2),
  sub_total      numeric(16,2),
  vat            numeric(16,2),
  grand_total    numeric(16,2),
  withhold       numeric(16,2) default 0,
  net_pay        numeric(16,2),
  deposited_bank text,
  status         text not null default 'processed' check (status in ('processed','submitted')),
  reported_by    text not null,
  photo_file_ids uuid[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sales_receipts_created_idx on sales_receipts (created_at desc);
create index if not exists sales_receipts_status_idx  on sales_receipts (status);

-- Per-chat scratch state for the multi-step receipt-scan flow (collected image
-- file ids + the working draft), mirroring the capture/draft jsonb columns.
alter table telegram_sessions
  add column if not exists receipt_scan jsonb;
