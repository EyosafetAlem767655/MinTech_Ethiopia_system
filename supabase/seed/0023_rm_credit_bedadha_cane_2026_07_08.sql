-- Dolomite bought on credit from the quarry owner Bedadha Cane, sales agent
-- Gezachew: 55 truckloads in five batches, 6 Jul - 11 Aug 2026.
--
-- Priced at 15,000 per tonne plus 15% VAT (17,250 per tonne): tonnes x 15,000 x
-- 1.15 gives every batch's total exactly, so each load carries its own amount and
-- the batches are kept only as a note.
--
--   2.1  542.80 t  9,363,300  unpaid
--   2.2  486.34 t  8,389,365  paid 2,218,853 via Zemen Bank (29 Jul), 6,170,512 left
--   2.3  388.26 t  6,697,485  paid 5,174,717 via Coop Bank (21 Jul), 1,522,768 left
--   2.4  485.46 t  8,374,185  unpaid
--   2.5  469.32 t  8,095,770  unpaid
--   Owed in total: 33,526,535.
--
-- A batch payment is put on its oldest loads first.
-- Re-runnable: it removes its own loads (their payments go with them).

begin;

delete from raw_material_credits where reported_by = 'Bedadha Cane statement (owner)';

insert into raw_material_credits (date, date_label, supplier, quarry_owner, sales_agent, truck_plate, material,
                                  tonnes, price_per_tonne, amount, note, reported_by, source)
select (v.day || 'T00:00:00Z')::timestamptz, v.day, 'Bedadha Cane', 'Bedadha Cane', 'Gezachew', v.plate, 'Dolomite',
       v.tons, 17250, v.amount, v.note, 'Bedadha Cane statement (owner)', 'app'
  from (values
  ('2026-08-08', '3-A34624Et', 39.48, 681030.0, 'Batch 2.1 · Inv. 1720633 · M.R.V 12773 · 15,000/t + 15% VAT'),
  ('2026-08-08', '3-A34623Et', 38.1, 657225.0, 'Batch 2.1 · Inv. 1720632 · M.R.V 12774 · 15,000/t + 15% VAT'),
  ('2026-08-08', '3-A18430Et', 37.22, 642045.0, 'Batch 2.1 · Inv. 1720634 · M.R.V 12775 · 15,000/t + 15% VAT'),
  ('2026-08-08', '3-A30611-39537Et', 58.78, 1013955.0, 'Batch 2.1 · Inv. 1720636 · M.R.V 12776 · 15,000/t + 15% VAT'),
  ('2026-08-08', '3-86418-17356Et', 51.54, 889065.0, 'Batch 2.1 · Inv. 1720637 · M.R.V 12777 · 15,000/t + 15% VAT'),
  ('2026-08-08', '3-A30609-13935Et', 55.28, 953580.0, 'Batch 2.1 · Inv. 709576 · M.R.V 12778 · 15,000/t + 15% VAT'),
  ('2026-08-08', '3-A30606-39532Et', 60.36, 1041210.0, 'Batch 2.1 · Inv. 709575 · M.R.V 12781 · 15,000/t + 15% VAT'),
  ('2026-08-10', '3-A09883Et-33135Et', 64.06, 1105035.0, 'Batch 2.1 · Inv. 1720638 · M.R.V 12783 · 15,000/t + 15% VAT'),
  ('2026-08-10', '3-85640-26401Et', 42.16, 727260.0, 'Batch 2.1 · Inv. 709577 · M.R.V 12787 · 15,000/t + 15% VAT'),
  ('2026-08-11', '3-A29204-44081Et', 57.18, 986355.0, 'Batch 2.1 · Inv. 1720640 · M.R.V 12788 · 15,000/t + 15% VAT'),
  ('2026-08-11', '3-AD6818Et', 38.64, 666540.0, 'Batch 2.1 · Inv. 1720639 · M.R.V 12789 · 15,000/t + 15% VAT'),
  ('2026-07-24', '3-A32511Et', 35.64, 614790.0, 'Batch 2.2 · Inv. 1720602 · M.R.V 12679 · 15,000/t + 15% VAT'),
  ('2026-07-24', '3-A35821Et', 33.62, 579945.0, 'Batch 2.2 · Inv. 1720603 · M.R.V 12680 · 15,000/t + 15% VAT'),
  ('2026-07-24', '3-A16624Et', 31.22, 538545.0, 'Batch 2.2 · Inv. 1720604 · M.R.V 12681 · 15,000/t + 15% VAT'),
  ('2026-07-25', '3-A42589-42795Et', 68.9, 1188525.0, 'Batch 2.2 · Inv. 1720606 · M.R.V 12688 · 15,000/t + 15% VAT'),
  ('2026-07-25', '3-A44342Et', 36.5, 629625.0, 'Batch 2.2 · Inv. 1720607 · M.R.V 12695 · 15,000/t + 15% VAT'),
  ('2026-07-27', '3-A12039-33619Et', 57.78, 996705.0, 'Batch 2.2 · Inv. 709566 · M.R.V 12699 · 15,000/t + 15% VAT'),
  ('2026-07-27', '3-A15097-32282Et', 56.66, 977385.0, 'Batch 2.2 · Inv. 709567 · M.R.V 12700 · 15,000/t + 15% VAT'),
  ('2026-07-29', '3-A34624Et', 37.32, 643770.0, 'Batch 2.2 · Inv. 1720614 · M.R.V 12720 · 15,000/t + 15% VAT'),
  ('2026-07-29', '3-A34623Et', 39.66, 684135.0, 'Batch 2.2 · Inv. 1720611 · M.R.V 12721 · 15,000/t + 15% VAT'),
  ('2026-07-29', '3-A18430Et', 36.04, 621690.0, 'Batch 2.2 · Inv. 1720612 · M.R.V 12722 · 15,000/t + 15% VAT'),
  ('2026-07-29', '3-A09573-33921Et', 53.0, 914250.0, 'Batch 2.2 · Inv. 709569 · M.R.V 12723 · 15,000/t + 15% VAT'),
  ('2026-07-06', '3-A39354Et', 32.26, 556485.0, 'Batch 2.3 · Inv. 709564 · M.R.V 12590 · 15,000/t + 15% VAT'),
  ('2026-07-07', '3-A06818Et', 34.1, 588225.0, 'Batch 2.3 · Inv. 709565 · M.R.V 12600 · 15,000/t + 15% VAT'),
  ('2026-07-17', '3-A34624Et', 37.66, 649635.0, 'Batch 2.3 · Inv. 1274591 · M.R.V 12641 · 15,000/t + 15% VAT'),
  ('2026-07-20', '3-A18430Et', 35.02, 604095.0, 'Batch 2.3 · Inv. 1274590 · M.R.V 12649 · 15,000/t + 15% VAT'),
  ('2026-07-20', '3-34623Et', 38.76, 668610.0, 'Batch 2.3 · Inv. 1274589 · M.R.V 12650 · 15,000/t + 15% VAT'),
  ('2026-07-20', '3-A24084Et', 33.28, 574080.0, 'Batch 2.3 · Inv. 1274592 · M.R.V 12651 · 15,000/t + 15% VAT'),
  ('2026-07-21', '3-A39354Et', 34.08, 587880.0, 'Batch 2.3 · Inv. 1274597 · M.R.V 12663 · 15,000/t + 15% VAT'),
  ('2026-07-21', '3-A34658Et', 37.98, 655155.0, 'Batch 2.3 · Inv. 1274599 · M.R.V 12664 · 15,000/t + 15% VAT'),
  ('2026-07-21', '3-A43927Et', 34.1, 588225.0, 'Batch 2.3 · Inv. 1274600 · M.R.V 12665 · 15,000/t + 15% VAT'),
  ('2026-07-21', '3-A43734Et', 33.44, 576840.0, 'Batch 2.3 · Inv. 1274598 · M.R.V 12666 · 15,000/t + 15% VAT'),
  ('2026-07-21', '3-A45105Et', 37.58, 648255.0, 'Batch 2.3 · Inv. 1720605 · M.R.V 12667 · 15,000/t + 15% VAT'),
  ('2026-08-02', '3-A08057-32321Et', 50.6, 872850.0, 'Batch 2.4 · Inv. 1720620 · M.R.V 12744 · 15,000/t + 15% VAT'),
  ('2026-08-02', '3-A43970Et', 34.04, 587190.0, 'Batch 2.4 · Inv. 1720627 · M.R.V 12745 · 15,000/t + 15% VAT'),
  ('2026-08-02', '3-A44833Et', 35.8, 617550.0, 'Batch 2.4 · Inv. 1720678 · M.R.V 12746 · 15,000/t + 15% VAT'),
  ('2026-08-02', '3-A45530Et', 34.42, 593745.0, 'Batch 2.4 · Inv. 1720626 · M.R.V 12747 · 15,000/t + 15% VAT'),
  ('2026-08-02', '3-A35072Et', 35.64, 614790.0, 'Batch 2.4 · Inv. 1720625 · M.R.V 12748 · 15,000/t + 15% VAT'),
  ('2026-08-02', '3-A44531Et', 36.0, 621000.0, 'Batch 2.4 · Inv. 1720624 · M.R.V 12749 · 15,000/t + 15% VAT'),
  ('2026-08-03', '3-A39354Et', 33.18, 572355.0, 'Batch 2.4 · Inv. 1720623 · M.R.V 12752 · 15,000/t + 15% VAT'),
  ('2026-08-06', '3-30604-39530Et', 53.12, 916320.0, 'Batch 2.4 · Inv. 1720631 · M.R.V 12769 · 15,000/t + 15% VAT'),
  ('2026-08-06', '3-A30605-39531Et', 60.0, 1035000.0, 'Batch 2.4 · Inv. 709574 · M.R.V 12770 · 15,000/t + 15% VAT'),
  ('2026-08-06', '3-A30607-39533Et', 54.9, 947025.0, 'Batch 2.4 · Inv. 709573 · M.R.V 12771 · 15,000/t + 15% VAT'),
  ('2026-08-06', '3-A30601-39528Et', 57.76, 996360.0, 'Batch 2.4 · Inv. 1720635 · M.R.V 12772 · 15,000/t + 15% VAT'),
  ('2026-07-29', '3-A15092-33617Et', 58.8, 1014300.0, 'Batch 2.5 · Inv. 709568 · M.R.V 12725 · 15,000/t + 15% VAT'),
  ('2026-07-30', '3-A06818Et', 36.56, 630660.0, 'Batch 2.5 · Inv. 1720613 · M.R.V 12726 · 15,000/t + 15% VAT'),
  ('2026-07-30', '3-A08354Et', 38.94, 671715.0, 'Batch 2.5 · Inv. 1720616 · M.R.V 12727 · 15,000/t + 15% VAT'),
  ('2026-07-30', '3-A24084Et', 33.12, 571320.0, 'Batch 2.5 · Inv. 1720615 · M.R.V 12729 · 15,000/t + 15% VAT'),
  ('2026-07-31', '3-A13573-33821Et', 46.72, 805920.0, 'Batch 2.5 · Inv. 1720617 · M.R.V 12730 · 15,000/t + 15% VAT'),
  ('2026-07-31', '3-A17217-34710Et', 50.06, 863535.0, 'Batch 2.5 · Inv. 1720618 · M.R.V 12731 · 15,000/t + 15% VAT'),
  ('2026-08-01', '3-A09588-33300Et', 47.8, 824550.0, 'Batch 2.5 · Inv. 709570 · M.R.V 12732 · 15,000/t + 15% VAT'),
  ('2026-08-01', '3-A43734Et', 33.7, 581325.0, 'Batch 2.5 · Inv. 709571 · M.R.V 12733 · 15,000/t + 15% VAT'),
  ('2026-08-01', '3-A13589Et', 36.6, 631350.0, 'Batch 2.5 · Inv. 1720622 · M.R.V 12741 · 15,000/t + 15% VAT'),
  ('2026-08-01', '3-A13602Et', 37.44, 645840.0, 'Batch 2.5 · Inv. 1720621 · M.R.V 12742 · 15,000/t + 15% VAT'),
  ('2026-08-02', '3-A09589-33347Et', 49.58, 855255.0, 'Batch 2.5 · Inv. 1720619 · M.R.V 12743 · 15,000/t + 15% VAT')
  ) as v(day, plate, tons, amount, note);

insert into raw_material_credit_payments (credit_id, amount, paid_on, note, recorded_by, part)
select c.id, v.amount, v.paid_on::date, v.note, 'Bedadha Cane statement (owner)', 'material'
  from (values
  ('Inv. 1720602 · M.R.V 12679 ·', 614790.0, '2026-07-29', 'Batch 2.2 payment via Zemen Bank'),
  ('Inv. 1720603 · M.R.V 12680 ·', 579945.0, '2026-07-29', 'Batch 2.2 payment via Zemen Bank'),
  ('Inv. 1720604 · M.R.V 12681 ·', 538545.0, '2026-07-29', 'Batch 2.2 payment via Zemen Bank'),
  ('Inv. 1720606 · M.R.V 12688 ·', 485573.0, '2026-07-29', 'Batch 2.2 payment via Zemen Bank'),
  ('Inv. 709564 · M.R.V 12590 ·', 556485.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank'),
  ('Inv. 709565 · M.R.V 12600 ·', 588225.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank'),
  ('Inv. 1274591 · M.R.V 12641 ·', 649635.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank'),
  ('Inv. 1274590 · M.R.V 12649 ·', 604095.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank'),
  ('Inv. 1274589 · M.R.V 12650 ·', 668610.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank'),
  ('Inv. 1274592 · M.R.V 12651 ·', 574080.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank'),
  ('Inv. 1274597 · M.R.V 12663 ·', 587880.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank'),
  ('Inv. 1274599 · M.R.V 12664 ·', 655155.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank'),
  ('Inv. 1274600 · M.R.V 12665 ·', 290552.0, '2026-07-21', 'Batch 2.3 payment via Coop Bank')
  ) as v(load_note, amount, paid_on, note)
  join raw_material_credits c on c.reported_by = 'Bedadha Cane statement (owner)' and c.note like '%' || v.load_note || '%';

commit;

-- Check: 55 loads, owed 33,526,535.
select count(*) as loads, sum(c.amount) as total,
       sum(c.amount) - coalesce((select sum(p.amount) from raw_material_credit_payments p
                                  join raw_material_credits x on x.id = p.credit_id
                                 where x.reported_by = 'Bedadha Cane statement (owner)'), 0) as owed
  from raw_material_credits c where c.reported_by = 'Bedadha Cane statement (owner)';
