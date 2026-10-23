-- Store unit prices from the August 2026 receipts (the owner's list).
--
-- PRICE ONLY: no stock is added or taken. Each item takes the LAST price listed
-- for it; the dates on the list are ignored and the PP bag lines are left out.
-- Items not on the store list are created (store_custom_items, the same table a
-- GRV adds to), in the group they belong with.
--
-- Prices are dated 2026-08-01, so they value August and every month after,
-- until a GRV records a newer price for the item.
--
-- Re-runnable: it replaces its own rows.

begin;

insert into store_custom_items (key, group_key, name, unit, created_from, created_by)
values
  ('x:printer-toner', 'stat', 'Printer toner', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:toner', 'stat', 'Toner', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:staples', 'stat', 'Staples', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:cash-register-paper', 'stat', 'Cash register paper', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:exercise-book', 'stat', 'Exercise book', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:student-bag', 'stat', 'Student bag', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:paint', 'cons', 'Paint', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:sand-paper', 'cons', 'Sand paper', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:nail', 'cons', 'Nail', 'kg', 'August 2026 receipts', 'August 2026 price list'),
  ('x:putty', 'cons', 'Putty', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:thinner', 'cons', 'Thinner', 'l', 'August 2026 receipts', 'August 2026 price list'),
  ('x:cement', 'cons', 'Cement', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:ceramic', 'cons', 'Ceramic', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:black-ceramic', 'cons', 'Black ceramic', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:marble', 'cons', 'Marble', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:kadisco-quartz', 'cons', 'Kadisco quartz', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:gibsim', 'cons', 'Gibsim', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:liquid-soap', 'cons', 'Liquid soap', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:hack-saw', 'cons', 'Hack saw', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:cutter', 'cons', 'Cutter', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:adapter', 'cons', 'Adapter', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:oil-seal', 'cons', 'Oil seal', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:metal', 'cons', 'Metal', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:self-screw', 'steel', 'Self screw', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:screw', 'steel', 'Screw', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:fisher', 'steel', 'Fisher', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:clip', 'steel', 'Clip', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:hinge', 'steel', 'Hinge', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:door-lock', 'steel', 'Door lock', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:cylindrical-lock', 'steel', 'Cylindrical lock', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:locker', 'steel', 'Locker', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:black-wire', 'elec2', 'Black wire', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:wire', 'elec2', 'Wire', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:insulation-tape', 'elec2', 'Insulation tape', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:flexible-cable', 'elec2', 'Flexible cable', 'm', 'August 2026 receipts', 'August 2026 price list'),
  ('x:breaker-box', 'elec2', 'Breaker box', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:trankeq', 'elec2', 'Trankeq', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:led-36w', 'elec2', 'LED 36W', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:led-24w', 'elec2', 'LED 24W', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:chargeable-battery', 'elec2', 'Chargeable battery', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:high-back-chair', 'added', 'High back chair', 'pcs', 'August 2026 receipts', 'August 2026 price list'),
  ('x:managerial-desk', 'added', 'Managerial desk', 'pcs', 'August 2026 receipts', 'August 2026 price list')
on conflict (key) do update set group_key = excluded.group_key, name = excluded.name, unit = excluded.unit;

delete from store_item_costs where recorded_by = 'August 2026 price list';

insert into store_item_costs (item_key, unit_cost, effective_from, source, ref, recorded_by)
select v.key, v.price, '2026-08-01', 'web', 'August 2026 receipts', 'August 2026 price list'
  from (values
  ('wsh:cut-180x1.6x22', 240),
  ('cons:hammer-6kg', 5652),
  ('cons:epoxy', 608),
  ('brk:25A', 1800),
  ('elec2:lamp-holder', 61),
  ('elec2:on-off-switch', 218),
  ('elec2:conduit', 200),
  ('elec2:lamp', 653),
  ('elec2:cable-2.5', 10435),
  ('ctl:change-over-switch', 7500),
  ('veh:brake-pad-toyota', 5653),
  ('cons:sewing-thread', 400),
  ('stat:stapler-wire', 52),
  ('stat:marker', 69),
  ('x:printer-toner', 2921.74),
  ('x:toner', 7391),
  ('x:staples', 1800),
  ('x:cash-register-paper', 82.61),
  ('x:exercise-book', 89),
  ('x:student-bag', 3435),
  ('x:paint', 2000),
  ('x:sand-paper', 217.91),
  ('x:nail', 2000),
  ('x:putty', 2173.91),
  ('x:thinner', 565),
  ('x:cement', 2700),
  ('x:ceramic', 2250),
  ('x:black-ceramic', 2800),
  ('x:marble', 9999.57),
  ('x:kadisco-quartz', 5913),
  ('x:liquid-soap', 739),
  ('x:hack-saw', 217),
  ('x:cutter', 217.39),
  ('x:adapter', 521.74),
  ('x:oil-seal', 500),
  ('x:metal', 869),
  ('x:self-screw', 826),
  ('x:screw', 173),
  ('x:fisher', 217),
  ('x:clip', 15),
  ('x:hinge', 86),
  ('x:door-lock', 2173),
  ('x:cylindrical-lock', 1826),
  ('x:locker', 130),
  ('x:black-wire', 330),
  ('x:wire', 943),
  ('x:insulation-tape', 260),
  ('x:flexible-cable', 3500),
  ('x:breaker-box', 3500),
  ('x:trankeq', 1400),
  ('x:led-36w', 2174),
  ('x:led-24w', 1739),
  ('x:chargeable-battery', 3043),
  ('x:high-back-chair', 21695.65),
  ('x:managerial-desk', 49521)
  ) as v(key, price);

commit;

-- Check: 55 prices, 42 new items.
select count(*) as prices from store_item_costs where recorded_by = 'August 2026 price list';
select count(*) as new_items from store_custom_items where created_by = 'August 2026 price list';
