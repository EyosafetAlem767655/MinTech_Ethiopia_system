-- PP bag manufacturers. Safe to run any number of times.
--
-- Every PP bag figure is now kept per company: received, used, damaged,
-- counted and priced. The company rides in the bag kind's key —
-- "kg40:Yellow" is Great Wall Packaging (every bag recorded before this), and
-- "kg40:Yellow@ethio-india" is Ethio-India — so no existing column changes.
--
-- Great Wall Packaging and Ethio-India are built into the code. This table
-- holds the companies added from the bot with "➕ Other".

create table if not exists pp_bag_companies (
  key        text primary key check (key ~ '^[a-z0-9-]+$'),
  name       text not null,
  created_at timestamptz not null default now()
);

alter table pp_bag_companies enable row level security;
alter table pp_bag_companies force  row level security;
