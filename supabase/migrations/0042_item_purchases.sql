-- What finance actually bought: one item, how many, at what price.
--
-- Filed from the bot (🛍 የዕቃ ግዢ) or from the pop-up that opens when a purchase
-- request is marked ✓ Bought. The item is matched to the store list where it
-- is on it (`item_key`), or kept by name as a new item.
--
-- A RECORD ONLY: a purchase does not move the store inventory — the GRV does
-- that when the goods reach the store, and counting both would add the same
-- goods twice. A matched item's unit price is kept as its cost
-- (store_item_costs, source 'purchase').
--
-- Both the unit price and the total are stored; `price_basis` says which one
-- was typed (pcs → the price of one; pak, litres, kg… → the total paid) and
-- the other was worked out from it.

create table if not exists item_purchases (
  id          uuid primary key default gen_random_uuid(),
  date        timestamptz not null,
  date_label  text not null,                 -- 'YYYY-MM-DD' in EAT
  item_name   text not null,
  item_key    text,                          -- store item key; null = new / not on the list
  is_new      boolean not null default false,
  qty         numeric(14,3) not null check (qty > 0),
  unit        text not null,
  unit_price  numeric(14,2) check (unit_price is null or unit_price >= 0),
  total       numeric(16,2) check (total is null or total >= 0),
  price_basis text check (price_basis is null or price_basis in ('unit', 'total')),
  request_id  uuid references purchase_requests(id) on delete set null,
  note        text,
  reported_by text not null,
  source      text not null default 'telegram' check (source in ('telegram', 'app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists item_purchases_date_idx    on item_purchases (date desc);
create index if not exists item_purchases_request_idx on item_purchases (request_id);

-- A purchase's price is a cost too.
alter table store_item_costs drop constraint if exists store_item_costs_source_check;
alter table store_item_costs add constraint store_item_costs_source_check
  check (source in ('grv', 'web', 'purchase'));

-- Same posture as every other table here: no Data API, no policies.
-- See 0031_data_api_lockdown.sql.
alter table item_purchases enable row level security;
alter table item_purchases force  row level security;
