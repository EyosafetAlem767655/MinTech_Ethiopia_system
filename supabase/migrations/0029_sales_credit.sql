-- Credit sales become something finance can collect.
--
-- `sales_invoices.invoice_credit` already records that a sale went out on
-- credit, and then nothing happened: no term, no way to say it was paid, no
-- warning when a client kept taking stock without settling the last lot. The
-- credit was visible on the sales sheet and invisible everywhere it mattered.
--
-- What is added is the COLLECTION side only — one row per payment received.
-- Everything else is derived: what is still outstanding is the invoice's credit
-- less the payments against it, and the due date is the sale date plus the
-- one-month term. Nothing is stored that a correction could make stale, which is
-- the same reason the whiteness averages are computed rather than kept.

create table if not exists sales_credit_payments (
  id           uuid primary key default gen_random_uuid(),
  -- Cascades, so purging a sale takes its payment history with it rather than
  -- leaving rows pointing at an invoice nobody can look up.
  invoice_id   uuid not null references sales_invoices(id) on delete cascade,
  -- Positive by constraint. A correction is made by DELETING the payment row,
  -- not by writing a negative one: a ledger that can go backwards silently is
  -- one nobody can add up by eye.
  amount       numeric(16,2) not null check (amount > 0),
  -- The day the money actually came in, which is not always the day it was
  -- keyed in. EAT, like every other date in this system.
  collected_on date not null default ((now() at time zone 'Africa/Addis_Ababa')::date),
  note         text,
  recorded_by  text not null default 'Dashboard',
  created_at   timestamptz not null default now()
);

create index if not exists sales_credit_payments_invoice_idx on sales_credit_payments (invoice_id);
create index if not exists sales_credit_payments_date_idx    on sales_credit_payments (collected_on desc);
