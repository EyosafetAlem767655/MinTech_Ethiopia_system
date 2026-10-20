-- Raw material bought on credit is one of the three materials finance accounts
-- in: Dolomite, Lime Stone and Talc. The load form now offers exactly those.
-- The older names stay valid so loads filed before this still pass.

alter table raw_material_credits drop constraint if exists raw_material_credits_material_check;
alter table raw_material_credits add constraint raw_material_credits_material_check
  check (material in ('Dolomite', 'Lime Stone', 'Talc', 'Kuni', 'Chips', 'Guji'));
