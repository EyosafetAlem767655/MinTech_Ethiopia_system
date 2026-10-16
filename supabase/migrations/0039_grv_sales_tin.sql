-- Three things the sales sheet and the store asked for at once.
--
-- 1. A sale's buyer is identified by TIN. Names are typed and read with every
--    spelling there is; the TIN printed on the invoice does not change, so it
--    is what the customer totals group by. Older sales get theirs from the
--    dashboard editor, or from the next receipt that prints it.
--
-- 2. A sale can be paid into several banks. `banks` holds one entry per bank
--    with what it received; `bank` stays, written as "CBE + Awash", for every
--    reader that predates this.
--
-- 3. The store list grows from the GRV. An item received that matches nothing
--    on the list (src/lib/store-items.ts) becomes a new item here, with a
--    permanent key like every listed one, so its balance and cost are tracked
--    from the voucher that brought it in.

/* ───────────────────────────── 1–2. Sales ────────────────────────────────── */

alter table sales_invoices add column if not exists tin   text;
alter table sales_invoices add column if not exists banks jsonb;  -- [{ "bank": "CBE", "amount": 300000 }]

-- Ten digits or nothing. Added NOT VALID so an odd legacy value cannot block
-- the migration; every new write is still checked.
do $$ begin
  alter table sales_invoices add constraint sales_invoices_tin_format check (tin is null or tin ~ '^[0-9]{10}$') not valid;
exception when duplicate_object then null; end $$;

create index if not exists sales_invoices_tin_idx on sales_invoices (tin);

/* ──────────────────────── 3. Items added from a GRV ──────────────────────── */

create table if not exists store_custom_items (
  key          text primary key,                -- "x:<slug>-<4 hex>", permanent like a listed key
  group_key    text not null,                   -- one of STORE_GROUPS
  name         text not null,
  description  text,
  unit         text not null default 'pcs',
  created_from text,                            -- the GRV number it arrived on
  created_by   text,
  created_at   timestamptz not null default now()
);

-- Same posture as every other table here: no Data API, no policies.
-- See 0031_data_api_lockdown.sql.
alter table store_custom_items enable row level security;
alter table store_custom_items force  row level security;
