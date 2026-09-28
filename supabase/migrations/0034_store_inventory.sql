-- The spare-parts store: one row per count.
--
-- The managers asked for every item on the shelf to be reported — 132 of them
-- across mechanical, electrical, oils and workshop — weekly, and sometimes more
-- often than that. Nothing in the system recorded any of it.
--
-- There is deliberately NO store_items table. The catalogue lives in code
-- (src/lib/store-items.ts) because the owner chose to keep it there for now:
-- one place to read, no screen to build, and no way for a typo in a pasted
-- count to become a permanent item that the real one then splits across.
--
-- `items` is { itemKey: quantity } using those permanent keys, and `groups`
-- names the blocks this count actually covered. A count is often PARTIAL — the
-- storekeeper does the bearings today and the electrics on Thursday — and the
-- difference between "counted and found zero" and "not counted" has to survive:
-- a group absent from `groups` keeps whatever the last count that included it
-- said, and is never read as a shelf full of nothing.
--
-- Current stock per item is therefore DERIVED (the newest count that included
-- that item's group), never a running balance. A balance would drift the first
-- time a block was skipped, and nothing on screen would say which figure to
-- believe.

create table if not exists store_counts (
  id          uuid primary key default gen_random_uuid(),
  date        timestamptz not null,
  date_label  text not null,                 -- 'YYYY-MM-DD' in EAT
  -- Which blocks were filed, e.g. {mechanical,electrical}. Not a count of them.
  groups      text[] not null default '{}',
  items       jsonb  not null default '{}',  -- { "brg:6210": 4, "belt:A52": 0 }
  counted_by  text not null,
  source      text not null default 'telegram' check (source in ('telegram','app')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Deliberately no unique key on date_label: two blocks counted on the same day
-- by two people are two honest counts, and collapsing them onto one row would
-- make the second silently overwrite the first.
create index if not exists store_counts_date_idx    on store_counts (date desc);
create index if not exists store_counts_created_idx on store_counts (created_at desc);

alter table store_counts enable row level security;
alter table store_counts force row level security;
