-- The two paper vouchers, as the system records them.
--
-- MinTech documents goods on two pre-printed pads:
--   • Goods Receiving Voucher — everything bought and received, PP bags included
--   • Store Issue Voucher     — everything taken out of the warehouse
--
-- Both are free-text line items with Unit / Qty / Unit Cost / Total. They
-- replace four overlapping bot flows (finance tool purchase, finance PP bag
-- receipt, asset PP bag report, daily raw-material issue), whose tables and rows
-- stay exactly where they are so history remains readable.
--
-- Between them they answer the question nothing could answer before: do the bags
-- production counts on the floor agree with what was bought minus what was
-- issued?

/* ─────────────────────── 1. Goods Receiving Voucher ───────────────────────── */

create table if not exists goods_receiving_vouchers (
  id            uuid primary key default gen_random_uuid(),
  -- The number printed on the pad, e.g. 5516.
  grv_no        text,
  date          timestamptz not null default now(),
  supplier      text,
  supplier_invoice_no      text,
  contract_no              text,
  receiving_store_no       text,
  letter_of_credit_no      text,
  purchase_requisition_no  text,
  purchase_order_no        text,
  currency      text not null default 'ETB' check (currency in ('ETB', 'USD')),
  total_amount  numeric(14,2),
  remarks       text,
  prepared_by   text,
  received_by   text,
  approved_by   text,
  reported_by   text not null,
  photo_file_ids uuid[] not null default '{}',
  -- Gemini's read of the receipt, cross-checked against the typed total. Same
  -- shape as sales_receipts.receipt_check.
  receipt_check jsonb,
  -- What the extractor read off the voucher photos, including lines it could not
  -- map to a stock item. Kept apart from receipt_check, which is only the total.
  extraction    jsonb,
  source        text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists grv_date_idx on goods_receiving_vouchers (date desc);

-- A voucher number identifies the delivery, and filing the same voucher twice is
-- exactly the error the reconciliation exists to catch: it would double the
-- month's received bags with nothing to say which entry was real. Refusing it at
-- the door is cheaper than finding it in a stock gap weeks later.
--
-- Partial, so a voucher with no number still files — the count matters more than
-- the paperwork being complete.
create unique index if not exists grv_no_unique_idx
  on goods_receiving_vouchers (grv_no) where grv_no is not null;

/* ───────────────────────── 2. Store Issue Voucher ─────────────────────────── */

create table if not exists store_issue_vouchers (
  id             uuid primary key default gen_random_uuid(),
  siv_no         text,
  date           timestamptz not null default now(),
  issuing_store  text,
  issued_to      text,
  department_section   text,
  store_requisition_no text,
  remarks        text,
  issued_by      text,
  approved_by    text,
  received_by    text,
  reported_by    text not null,
  photo_file_ids uuid[] not null default '{}',
  extraction     jsonb,
  source         text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists siv_date_idx on store_issue_vouchers (date desc);

create unique index if not exists siv_no_unique_idx
  on store_issue_vouchers (siv_no) where siv_no is not null;

/* ──────────────────────────── 3. The line items ───────────────────────────── */

-- Both line tables carry the voucher's own columns plus three that turn free
-- text into something countable:
--
--   ledger_kind  'bag' | 'material' | null
--   ledger_key   'kg25:Yellow' | 'Dolomite' | …
--   ledger_qty   pieces for bags, tonnes for materials
--
-- They stay NULL until a person confirms them. A line reading "PP bag 25KG
-- Yellow" is a string; ledger_key = 'kg25:Yellow' is a claim about stock, and
-- only the second one is ever summed into a report. The AI may suggest the
-- mapping, but a quantity that nobody agreed to does not move a balance.
--
-- ledger_qty is separate from quantity on purpose: a line of "100 pak" is not
-- 100 pieces, and inferring a pack size the system was never told is how a bag
-- count silently triples.

create table if not exists goods_receiving_items (
  id           uuid primary key default gen_random_uuid(),
  grv_id       uuid not null references goods_receiving_vouchers(id) on delete cascade,
  position     integer not null default 0,
  stock_code   text,
  description  text not null,
  unit         text,
  quantity     numeric(14,3),
  unit_cost    numeric(14,2),
  total_amount numeric(14,2),
  ledger_kind  text check (ledger_kind is null or ledger_kind in ('bag', 'material')),
  ledger_key   text,
  ledger_qty   numeric(14,3),
  created_at   timestamptz not null default now()
);
create index if not exists grv_items_voucher_idx on goods_receiving_items (grv_id, position);
create index if not exists grv_items_ledger_idx  on goods_receiving_items (ledger_kind, ledger_key)
  where ledger_kind is not null;

create table if not exists store_issue_items (
  id           uuid primary key default gen_random_uuid(),
  siv_id       uuid not null references store_issue_vouchers(id) on delete cascade,
  position     integer not null default 0,
  stock_code   text,
  description  text not null,
  unit         text,
  quantity     numeric(14,3),
  unit_cost    numeric(14,2),
  total_amount numeric(14,2),
  ledger_kind  text check (ledger_kind is null or ledger_kind in ('bag', 'material')),
  ledger_key   text,
  ledger_qty   numeric(14,3),
  created_at   timestamptz not null default now()
);
create index if not exists siv_items_voucher_idx on store_issue_items (siv_id, position);
create index if not exists siv_items_ledger_idx  on store_issue_items (ledger_kind, ledger_key)
  where ledger_kind is not null;
