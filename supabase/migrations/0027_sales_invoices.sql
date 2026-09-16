-- The sales report becomes one row per transaction, in the shape of the sales sheet.
--
-- It was one Payment Summary photograph a day (0024): five payment methods and
-- their totals, which said how much money came in but not from whom, for what,
-- or through which bank. The questions the owner actually asks of sales — who
-- buys the most, which brand sells, cash against credit, which bank the money
-- lands in — cannot be answered from a daily total, so the report goes back to
-- the transaction, filed receipt-first from the bot.
--
-- The columns are the company's own sales sheet: Date · Deliver to · Invoice in
-- cash · Invoice in credit · Invoice qty · Deli · one tonnage per brand · Bank.

/* ─────────────────────────── 1. One row per sale ─────────────────────────── */

create table if not exists sales_invoices (
  id             uuid primary key default gen_random_uuid(),
  date           timestamptz not null,
  date_label     text not null,                       -- 'YYYY-MM-DD' in EAT, like the other daily tables
  customer       text not null,                       -- "Deliver to"
  invoice_cash   numeric(16,2) not null default 0,    -- ETB invoiced and paid in cash
  invoice_credit numeric(16,2) not null default 0,    -- ETB invoiced on credit
  -- Derived in code from `products`, never typed: a total that disagrees with
  -- its own brand lines is the classic sheet error, and the derived figure is
  -- the one every report is built from.
  qty            numeric(14,3) not null default 0,    -- tonnes, all brands
  delivery_no    text,                                -- "Deli", the numerical code on the sheet
  products       jsonb not null default '{}'::jsonb,  -- { "ETL15": 12.5, "3EL": 4, … } tonnes
  -- One of the fixed bank list (src/lib/banks.ts) or, for "Other", whatever was
  -- typed. Kept as text rather than an enum so a new bank never needs a
  -- migration; the list in code is what keeps the analytics grouping clean.
  bank           text,
  -- What the model read off the receipts, kept for the audit trail: confidence,
  -- notes and which fields it filled. NO image reference of any kind — the
  -- receipts are read once and never stored or pointed at (see 0026).
  extraction     jsonb,
  reported_by    text not null,
  source         text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists sales_invoices_date_idx     on sales_invoices (date desc);
create index if not exists sales_invoices_customer_idx on sales_invoices (customer);
create index if not exists sales_invoices_bank_idx     on sales_invoices (bank);

/* ──────────────────── 2. The daily payment summary goes ──────────────────── */

-- Dropped rather than kept, by decision — the same call as sales_receipts in
-- 0024. Every consumer (dashboard, brief, chat, archive, Settings) now reads
-- sales_invoices; revenue is invoice_cash + invoice_credit.
drop table if exists daily_sales_summaries cascade;
