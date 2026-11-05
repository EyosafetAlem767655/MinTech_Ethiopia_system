-- Store unit prices, the owner's list of November 2026.
--
-- PRICE ONLY: no stock is added or taken. Where one line on the list fits two
-- items (Rotary valve, Grinding disck, Eye googe, Carbon brush) both take the
-- price, by the owner's word. "Break pad" is not the Toyota pad, so it is
-- created (store_custom_items, the same table a GRV adds to).
--
-- Prices are dated 2026-11-01: they value November and every month after, until
-- a GRV records a newer one. An item priced in August keeps that price for
-- August to October; an item never priced before uses this one for past months.
--
-- Re-runnable: it replaces its own rows.

begin;

insert into store_custom_items (key, group_key, name, unit, created_from, created_by)
values
  ('x:break-pad', 'veh', 'Break pad', 'pcs', 'November 2026 price list', 'November 2026 price list')
on conflict (key) do update set group_key = excluded.group_key, name = excluded.name, unit = excluded.unit;

delete from store_item_costs where recorded_by = 'November 2026 price list';

insert into store_item_costs (item_key, unit_cost, effective_from, source, ref, recorded_by)
select v.key, v.price, '2026-11-01', 'web', 'November 2026 price list', 'November 2026 price list'
  from (values
  ('comp:oil-separator', 311715),
  ('comp:oil-filter', 144840),
  ('comp:air-filter-insert', 121334),
  ('brg:6210', 2800),
  ('brg:6216', 8000),
  ('brg:6313', 7000),
  ('brg:6205', 400),
  ('brg:1208', 2200),
  ('brg:6311', 4000),
  ('brg:1210', 2800),
  ('brg:6204', 600),
  ('brg:6219', 17000),
  ('brg:1209', 4000),
  ('brg:22213', 8000),
  ('brg:6222', 3800),
  ('brg:6209', 2117),
  ('brg:6306', 690),
  ('brg:6315', 2300),
  ('brg:6206', 2000),
  ('brg:6010', 850),
  ('brg:6228', 11300),
  ('brg:6308', 1900),
  ('plant:fixed-jaw', 78000),
  ('plant:movable-jaw', 14357),
  ('plant:rotary-valve-300', 12000),
  ('plant:rotary-valve-250', 12000),
  ('comp:condensate-drain', 20096),
  ('filt:bag-3475', 568),
  ('filt:bag-2600', 340.56),
  ('filt:bag-3710', 604.2),
  ('wsh:cut-180x1.6x22', 240),
  ('wsh:electrod-2.5', 1652),
  ('wsh:grind-180x5.5x22.2', 286),
  ('wsh:grind-180x6.5', 286),
  ('wsh:cut-180x22', 400),
  ('wsh:electrod-84.78', 6350),
  ('wsh:ok67.46-3.2', 5200),
  ('filt:loader-fuel-5020', 1156.52),
  ('filt:loader-fuel-5030', 1156.52),
  ('filt:loader-oil-640', 1608),
  ('wsh:electrod-holder', 1260),
  ('safety:boots', 700),
  ('belt:C150', 4300),
  ('belt:C83', 1500),
  ('belt:D165', 4347),
  ('belt:A54', 252),
  ('belt:A65', 652),
  ('belt:A59', 260),
  ('belt:9.5x650', 350),
  ('belt:A58', 700),
  ('belt:A50', 4000),
  ('belt:B72', 695),
  ('belt:A52', 434),
  ('oil:industrial-320', 113218),
  ('oil:gas', 180.12),
  ('plant:packing-seal', 1800),
  ('seal:sleeve-h09', 2000),
  ('seal:sleeve-1211', 4000),
  ('seal:sleeve-1210', 2800),
  ('plant:plumber-block-510', 2000),
  ('seal:shaft-60x80x10', 2000),
  ('seal:shaft-80x110x12', 869),
  ('seal:shaft-60x80x10-2', 4700),
  ('seal:oil-35x47x10', 565),
  ('seal:oil-50x70x10', 4500),
  ('seal:shaft-100x70x10', 14000),
  ('seal:shaft-90x70x10', 13000),
  ('seal:shaft-42x62x10', 4200),
  ('seal:seal-30x50x10', 4800),
  ('filt:air-toyota-minibus', 6500),
  ('filt:fuel-16405', 3500),
  ('plant:belt-fastener', 220),
  ('wsh:sqbar-40', 43782),
  ('wsh:sqbar-10', 4956),
  ('wsh:sqbar-30', 22608),
  ('cons:rbar-25', 10000),
  ('safety:goggle-white', 450),
  ('safety:goggle-black', 450),
  ('safety:shovel', 391),
  ('cons:hammer-6kg', 5000),
  ('cons:silicone', 1434),
  ('veh:tyre-6.50-10', 17840),
  ('filt:oil-90915', 1160),
  ('filt:oil-23390-64480', 2800),
  ('filt:oil-15208', 2000),
  ('filt:air-wl81', 4500),
  ('x:break-pad', 17000),
  ('wsh:tyre-loader', 121739),
  ('veh:ujoint-bearing-mazda', 13000),
  ('plant:toothed-belt', 4000),
  ('safety:plastic-hammer', 260),
  ('plant:diaphragm-1', 2000),
  ('plant:diaphragm-1.5', 2000),
  ('steel:fiber-glass', 4483),
  ('comp:separator-filter-keashan', 150000),
  ('wsh:electrod-3.2', 2400),
  ('wsh:cut-230x2x22.2', 240),
  ('steel:plastic-sheet', 6000),
  ('elc:carbon-brush-makita', 300),
  ('elc:carbon-brush-bosch', 300),
  ('oil:dacsin-46', 21795),
  ('veh:ujoint-48x120', 10000),
  ('elc:load-cell-30t', 40000),
  ('veh:feeding-pump', 19945),
  ('filt:oil-wl-yo14', 5000)
  ) as v(key, price);

commit;

-- Check: 105 prices, 1 new item.
select count(*) as prices from store_item_costs where recorded_by = 'November 2026 price list';
select count(*) as new_items from store_custom_items where created_by = 'November 2026 price list';
