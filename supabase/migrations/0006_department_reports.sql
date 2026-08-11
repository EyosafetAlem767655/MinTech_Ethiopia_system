-- Department report formats (additive): structured storage for the five company
-- report types captured via the Telegram bot (text / photo / Excel) and shown on
-- the matching department tab. Per-product line items are jsonb, consistent with
-- daily_ops_reports. Nothing here alters existing tables.

-- Image 2 — daily production grid (Date × product, FGR No).
create table if not exists production_reports (
  id          uuid primary key default gen_random_uuid(),
  date        timestamptz not null default now(),
  fgr_no      text,
  reported_by text not null,
  products    jsonb not null default '{}',   -- { productCode: tons }
  source      text not null default 'telegram' check (source in ('telegram','app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists production_reports_created_idx on production_reports (created_at desc);
create index if not exists production_reports_date_idx    on production_reports (date desc);

-- Image 1 — monthly finished/raw/packing material stock-status (entered per report,
-- including unit prices and opening balances).
create table if not exists stock_status_reports (
  id          uuid primary key default gen_random_uuid(),
  month       text not null,                 -- "YYYY-MM" (or the sheet's month label)
  reported_by text not null,
  items       jsonb not null default '[]',   -- [{ code, description, category, bBalance, received, sales, unitPrice, stockTon, etb }]
  source      text not null default 'telegram' check (source in ('telegram','app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists stock_status_reports_created_idx on stock_status_reports (created_at desc);

-- Image 3 — raw material received (Asset Management).
create table if not exists raw_material_receipts (
  id          uuid primary key default gen_random_uuid(),
  date        timestamptz not null default now(),
  supplier    text,
  dn_no       text,
  truck_plate text,
  mrv_no      text,
  reported_by text not null,
  materials   jsonb not null default '{}',   -- { material: qty }
  source      text not null default 'telegram' check (source in ('telegram','app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists raw_material_receipts_created_idx on raw_material_receipts (created_at desc);

-- Image 4 — finished-goods delivery (Sales).
create table if not exists delivery_reports (
  id           uuid primary key default gen_random_uuid(),
  date         timestamptz not null default now(),
  customer     text not null,
  invoice_no   text,
  payment_type text check (payment_type in ('cash','credit')),
  qty          numeric(14,3),
  delivery_no  text,
  reported_by  text not null,
  products     jsonb not null default '{}',  -- { productCode: qty }
  source       text not null default 'telegram' check (source in ('telegram','app')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists delivery_reports_created_idx on delivery_reports (created_at desc);
create index if not exists delivery_reports_date_idx    on delivery_reports (date desc);

-- Image 5 — foreign & local purchased items (Asset Management).
create table if not exists purchase_item_reports (
  id          uuid primary key default gen_random_uuid(),
  date        timestamptz not null default now(),
  description text not null,
  uom         text,
  qty         numeric(14,3),
  supplier    text,
  amount      numeric(14,2),
  cost_center text,
  purchaser   text,
  reported_by text not null,
  source      text not null default 'telegram' check (source in ('telegram','app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists purchase_item_reports_created_idx on purchase_item_reports (created_at desc);
