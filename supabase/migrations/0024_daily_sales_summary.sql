-- The sales report becomes one photograph a day.
--
-- It used to be one report per transaction: photograph the receipts, read them,
-- fill the gaps, approve, repeat for the next sale. On a busy day that is the
-- same six steps a dozen times over, and it was reported as exhausting.
--
-- What replaces it is the till's own end-of-day Payment Summary — five payment
-- methods, each with an amount taken and an amount refunded. Ten numbers and
-- their totals, read once.

/* ─────────────────────── 1. The day's payment summary ────────────────────── */

create table if not exists daily_sales_summaries (
  id          uuid primary key default gen_random_uuid(),
  -- One row per day, upserted. Re-filing a day REPLACES it: two rows for one
  -- day would be added together by every figure on the dashboard, and a
  -- correction would read as a second day's trading.
  date_label  text not null unique,        -- 'YYYY-MM-DD' in EAT
  date        timestamptz not null,

  -- The five methods, as columns rather than a jsonb map. The dashboard sums
  -- these on every load, and sum(cash_payment) is both clearer and faster than
  -- reaching into jsonb to do the same arithmetic.
  cash_payment    numeric(16,2) not null default 0,
  cash_refund     numeric(16,2) not null default 0,
  cheque_payment  numeric(16,2) not null default 0,
  cheque_refund   numeric(16,2) not null default 0,
  card_payment    numeric(16,2) not null default 0,
  card_refund     numeric(16,2) not null default 0,
  credit_payment  numeric(16,2) not null default 0,
  credit_refund   numeric(16,2) not null default 0,
  voucher_payment numeric(16,2) not null default 0,
  voucher_refund  numeric(16,2) not null default 0,

  -- Derived in code from the ten above, never read off the receipt. A printed
  -- total that disagrees with its own rows is the single most useful thing a
  -- scan can surface, and it cannot be surfaced by a column that was copied
  -- from the same printed total.
  total_payment numeric(16,2) not null default 0,
  total_refund  numeric(16,2) not null default 0,
  -- What actually came in: payments less refunds. This is what the dashboard
  -- reads as "collections", where it previously read net of withholding.
  net_total     numeric(16,2) not null default 0,

  -- The total as PRINTED, when one was read. Kept beside the computed figure
  -- rather than instead of it, so a disagreement stays visible afterwards.
  printed_total numeric(16,2),

  -- Telegram file ids. The photograph is never uploaded to storage — see
  -- migration 0023 and src/lib/images.ts.
  tg_file_ids text[] not null default '{}',
  -- The model's own confidence and notes on the read.
  extraction  jsonb,

  reported_by text not null,
  source      text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists daily_sales_summaries_date_idx on daily_sales_summaries (date desc);

/* ────────────────────── 2. The per-transaction tables go ─────────────────── */

-- Dropped rather than kept as history, by decision: the sales tab starts clean.
--
-- The finance pipeline is preserved by MAPPING, not by keeping these rows.
-- Every consumer only ever read three things from sales_receipts — date,
-- grand_total and net_pay — and those become date, total_payment and net_total
-- above. See src/lib/metrics.ts and src/lib/department-metrics.ts.
drop table if exists sales_receipts cascade;

-- The read queue that served the per-sale flow. One photograph of ten numbers
-- is read inside the reply itself, the way the GRV voucher already is, so there
-- is nothing left to queue.
drop table if exists sales_scan_jobs cascade;
