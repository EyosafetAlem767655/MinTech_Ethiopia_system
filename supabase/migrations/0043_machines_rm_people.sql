-- Two things the plant needs to trace. Safe to run any number of times.
--
-- 1. WHICH MACHINE OR CAR. Every item taken out of the store (a line on the
--    Store Issue Voucher) and every purchase request records the machine or
--    vehicle it is for. Free text: the bot offers the names already used as
--    buttons, so the list builds itself. Null on a purchase request means
--    PP bags / oil — nothing a machine is named for.
--
-- 2. RAW MATERIAL ON CREDIT, WITH ITS PEOPLE. A load now records the three
--    people behind it — the quarry owner, the sales agent and the driver — and
--    two amounts owed: the raw material itself and the driver's fee. Each
--    payment says which of the two it paid. Older loads read as a driver fee
--    of 0, and older payments as paying the material, so nothing filed before
--    this changes.

alter table store_issue_items add column if not exists machine text;
alter table purchase_requests add column if not exists machine text;

alter table raw_material_credits
  add column if not exists quarry_owner text,
  add column if not exists sales_agent  text,
  add column if not exists driver_name  text,
  add column if not exists driver_fee   numeric(14,2) not null default 0;

alter table raw_material_credit_payments
  add column if not exists part text not null default 'material';

alter table raw_material_credit_payments drop constraint if exists raw_material_credit_payments_part_check;
alter table raw_material_credit_payments add constraint raw_material_credit_payments_part_check
  check (part in ('material', 'driver'));

create index if not exists store_issue_items_machine_idx on store_issue_items (lower(machine)) where machine is not null;
