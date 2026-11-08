-- Credit sales, started fresh from the owner's own papers (owner's decision),
-- EXCEPT the credit sales filed from 20 October 2026 on, which are kept.
--
--   * Credit sales dated before 20 Oct 2026 are REMOVED with their payments and
--     replaced by the owner's two documents. A copy is kept first in
--     credit_reset_backup_invoices / credit_reset_backup_payments.
--   * Credit sales dated 20 Oct 2026 or later are KEPT. Each is marked collected
--     only if the Cash Collection Summary shows it: same customer, same tonnes,
--     sold on or up to 7 days before the collection date.
--
--   1. "Credit sales up to Oct 31, 2026, uncollected": 34 sales, 567.63 t, owed at
--      NET PAY (owner's decision) = 12,771,512.70. A line from 20 Oct on that is
--      already on file (same customer, day and tonnes) is not added twice.
--   2. "Cash Collection Summary", Oct 2026: 8 credit sales collected, 470.83 t,
--      14,728,084.50. A line that matches a kept sale pays that sale; any other
--      line is added as a collected credit sale (its one date used for both the
--      sale and the collection). CRV 3833 is void and is not on it.
--
-- Cash sales are untouched; a sale with both parts keeps its cash part.
-- Re-runnable: it replaces its own rows and its own payments. Do NOT re-run the
-- July-October sales seeds (0006, 0007, 0008, 0016) after this: they would bring
-- the old credit sales back.

begin;

create table if not exists credit_reset_backup_invoices as select * from sales_invoices where false;
create table if not exists credit_reset_backup_payments as select * from sales_credit_payments where false;
alter table credit_reset_backup_invoices enable row level security;
alter table credit_reset_backup_payments enable row level security;

/* This seed's own rows and payments out first, so a re-run starts clean. */
delete from sales_credit_payments where recorded_by = 'cash collection summary Oct 2026';
delete from sales_invoices where reported_by in ('credit statement 31 Oct 2026', 'cash collection summary Oct 2026');

/* 1. Copy, then remove, the credit sales before 20 October. */
insert into credit_reset_backup_payments
select p.* from sales_credit_payments p
  join sales_invoices i on i.id = p.invoice_id
 where i.invoice_credit > 0
   and (i.date at time zone 'Africa/Addis_Ababa')::date < date '2026-10-20'
   and not exists (select 1 from credit_reset_backup_payments b where b.id = p.id);

insert into credit_reset_backup_invoices
select i.* from sales_invoices i
 where i.invoice_credit > 0
   and (i.date at time zone 'Africa/Addis_Ababa')::date < date '2026-10-20'
   and not exists (select 1 from credit_reset_backup_invoices b where b.id = i.id);

delete from sales_invoices
 where invoice_credit > 0 and invoice_cash = 0
   and (date at time zone 'Africa/Addis_Ababa')::date < date '2026-10-20';

delete from sales_credit_payments p using sales_invoices i
 where p.invoice_id = i.id and i.invoice_credit > 0 and i.invoice_cash > 0
   and (i.date at time zone 'Africa/Addis_Ababa')::date < date '2026-10-20';
update sales_invoices set invoice_credit = 0
 where invoice_credit > 0 and invoice_cash > 0
   and (date at time zone 'Africa/Addis_Ababa')::date < date '2026-10-20';

/* 2. The uncollected statement, at net pay; a line already on file is not added twice. */
insert into sales_invoices (date, date_label, customer, invoice_cash, invoice_credit, qty, delivery_no, products, extraction, reported_by, source)
select (v.day || 'T00:00:00Z')::timestamptz, v.label, v.customer, 0, v.net, v.qty, v.fs, v.products, v.extraction, 'credit statement 31 Oct 2026', 'app'
  from (values
  ('2025-11-01', '1/11/2025', 'Mela Soap and Detergent', 63201.6, 5.7, '1174', '{"ETL9": 5.7}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8123", "unitPrice": 9900, "grandTotal": 64894.5, "withhold": 1692.9, "netPay": 63201.6}'::jsonb),
  ('2025-11-07', '7/11/2025', 'Mela Soap and Detergent', 110880, 10, '1206', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8133", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-11-08', '8/11/2025', 'Mela Soap and Detergent', 221760, 20, '1208', '{"ETL9": 20}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8134", "unitPrice": 9900, "grandTotal": 227700, "withhold": 5940, "netPay": 221760}'::jsonb),
  ('2025-11-11', '11/11/2025', 'Mela Soap and Detergent', 110880, 10, '1220', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8139", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-11-14', '14/11/2025', 'Mela Soap and Detergent', 110880, 10, '1247', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8147", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-11-15', '15/11/2025', 'Mela Soap and Detergent', 332640, 30, '1250', '{"ETL9": 30}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8148", "unitPrice": 9900, "grandTotal": 341550, "withhold": 8910, "netPay": 332640}'::jsonb),
  ('2025-11-20', '20/11/2025', 'Mela Soap and Detergent', 110880, 10, '1273', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8154", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-11-21', '21/11/2025', 'Mela Soap and Detergent', 110880, 10, '1281', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8157", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-11-26', '26/11/2025', 'Mela Soap and Detergent', 110880, 10, '1301', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8158", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-11-28', '28/11/2025', 'Mela Soap and Detergent', 111870, 10, '1317', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8162", "unitPrice": 9900, "grandTotal": 113850, "withhold": 1980, "netPay": 111870}'::jsonb),
  ('2025-11-29', '29/11/2025', 'Mela Soap and Detergent', 111870, 10, '1319', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8163", "unitPrice": 9900, "grandTotal": 113850, "withhold": 1980, "netPay": 111870}'::jsonb),
  ('2025-12-02', '2/12/2025', 'Mela Soap and Detergent', 110880, 10, '1335', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8167", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-12-03', '3/12/2025', 'Mela Soap and Detergent', 110880, 10, '1344', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8169", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-12-06', '6/12/2025', 'Mela Soap and Detergent', 110880, 10, '1365', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8174", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-12-12', '12/12/2025', 'Mela Soap and Detergent', 110880, 10, '1413', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8186", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-12-13', '13/12/2025', 'Mela Soap and Detergent', 110880, 10, '1428', '{"ETL9": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8191", "unitPrice": 9900, "grandTotal": 113850, "withhold": 2970, "netPay": 110880}'::jsonb),
  ('2025-03-17', '17/3/2025', 'Mitiku Mekuria', 64884.6, 6.6, '0172', '{"EC90": 6.6}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "7870", "unitPrice": 8700, "grandTotal": 66033, "withhold": 1148.4, "netPay": 64884.6}'::jsonb),
  ('2025-03-25', '25/3/2025', 'Mitiku Mekuria', 147465, 15, '0213', '{"EC90": 15}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "7883", "unitPrice": 8700, "grandTotal": 150075, "withhold": 2610, "netPay": 147465}'::jsonb),
  ('2025-04-04', '4/4/2025', 'Mitiku Mekuria', 101700, 10, '0259', '{"EC90": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "7893", "unitPrice": 9000, "grandTotal": 103500, "withhold": 1800, "netPay": 101700}'::jsonb),
  ('2025-04-14', '14/4/2025', 'Mitiku Mekuria', 101700, 10, '0295', '{"EC90": 10}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "7898", "unitPrice": 9000, "grandTotal": 103500, "withhold": 1800, "netPay": 101700}'::jsonb),
  ('2026-10-26', '26/10/2026', 'Netsanet Asefa', 459229.5, 14.79, '3246', '{"5EL": 14.79}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8516", "unitPrice": 27000, "grandTotal": 459229.5, "withhold": 0, "netPay": 459229.5}'::jsonb),
  ('2026-10-26', '26/10/2026', 'Netsanet Asefa', 652050, 21, '3247', '{"5EL": 21}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8517", "unitPrice": 27000, "grandTotal": 652050, "withhold": 0, "netPay": 652050}'::jsonb),
  ('2026-10-26', '26/10/2026', 'Netsanet Asefa', 652050, 21, '3248', '{"5EL": 21}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8518", "unitPrice": 27000, "grandTotal": 652050, "withhold": 0, "netPay": 652050}'::jsonb),
  ('2026-10-27', '27/10/2026', 'Netsanet Asefa', 652050, 21, '3253', '{"5EL": 21}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8519", "unitPrice": 27000, "grandTotal": 652050, "withhold": 0, "netPay": 652050}'::jsonb),
  ('2026-04-07', '7/4/2026', 'Workenhe', 35052, 2.54, '2202', '{"EC90": 2.54}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8342", "unitPrice": 12000, "grandTotal": 35052, "withhold": 0, "netPay": 35052}'::jsonb),
  ('2026-04-08', '8/4/2026', 'Workenhe', 69000, 5, '2211', '{"EC90": 5}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8347", "unitPrice": 12000, "grandTotal": 69000, "withhold": 0, "netPay": 69000}'::jsonb),
  ('2026-04-08', '8/4/2026', 'Workenhe', 69000, 5, '2215', '{"EC90": 5}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8348", "unitPrice": 12000, "grandTotal": 69000, "withhold": 0, "netPay": 69000}'::jsonb),
  ('2026-04-22', '22/4/2026', 'Wale Workneh', 86250, 5, '2277', '{"EC15": 5}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8360", "unitPrice": 15000, "grandTotal": 86250, "withhold": 0, "netPay": 86250}'::jsonb),
  ('2026-02-06', '6/2/2026', 'Zemili Paint Factory PLC', 104860, 5, '1728', '{"3EL": 5}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8273", "unitPrice": 18725, "grandTotal": 107668.75, "withhold": 2808.75, "netPay": 104860}'::jsonb),
  ('2026-08-06', '6/8/2026', 'MaxFlow Manufacturing PLC', 134400, 5, '2879', '{"ETL9": 5}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8476", "unitPrice": 24000, "grandTotal": 138000, "withhold": 3600, "netPay": 134400}'::jsonb),
  ('2026-08-06', '6/8/2026', 'MaxFlow Manufacturing PLC', 537600, 20, '2883', '{"ETL9": 20}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8477", "unitPrice": 24000, "grandTotal": 552000, "withhold": 14400, "netPay": 537600}'::jsonb),
  ('2026-08-06', '6/8/2026', 'MaxFlow Manufacturing PLC', 403200, 15, '2884', '{"ETL9": 15}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8478", "unitPrice": 24000, "grandTotal": 414000, "withhold": 10800, "netPay": 403200}'::jsonb),
  ('2026-09-29', '29/9/2026', 'Solomon Yishak', 3220000, 100, '3151', '{"2EL": 100}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8499", "unitPrice": 28000, "grandTotal": 3220000, "withhold": 0, "netPay": 3220000}'::jsonb),
  ('2026-09-30', '30/9/2026', 'Solomon Yishak', 3220000, 100, '3155', '{"2EL": 100}'::jsonb, '{"sheet": "Credit sales up to 31 Oct 2026, uncollected", "attNo": "8500", "unitPrice": 28000, "grandTotal": 3220000, "withhold": 0, "netPay": 3220000}'::jsonb)
  ) as v(day, label, customer, net, qty, fs, products, extraction)
 where not exists (
   select 1 from sales_invoices i
    where i.invoice_credit > 0
      and (i.date at time zone 'Africa/Addis_Ababa')::date = (v.day)::date
      and i.qty = v.qty
      and left(lower(regexp_replace(i.customer, '[^a-zA-Z0-9]', '', 'g')), 5)
        = left(lower(regexp_replace(v.customer, '[^a-zA-Z0-9]', '', 'g')), 5)
 );

/* 3. The collection summary: pay the kept sale it matches, or add it collected. */
do $$
declare
  v record;
  part record;
  hit uuid;
  key5 text;
  left_over jsonb;
  left_amount numeric;
begin
  for v in
    select * from (values
    ('2026-10-20', '20/10/2026', 'Maruti Plastic Industry', 1725000, 50, '{"2EL": 50}'::jsonb, '{"sheet": "Cash collection summary, Oct 2026", "crv": "3861", "bank": "CBE", "collectedBy": "Nigist Tesfaye", "unitPrices": {"2EL": 30000}}'::jsonb, 'Collected · CRV 3861 · CBE · collected by Nigist Tesfaye'),
    ('2026-10-29', '29/10/2026', 'Maruti Plastic Industry', 3450000, 100, '{"2EL": 100}'::jsonb, '{"sheet": "Cash collection summary, Oct 2026", "crv": "3862", "bank": "CBE", "collectedBy": "Nigist Tesfaye", "unitPrices": {"2EL": 30000}}'::jsonb, 'Collected · CRV 3862 · CBE · collected by Nigist Tesfaye'),
    ('2026-10-29', '29/10/2026', 'Gidabo Soap', 2576000, 80, '{"3EL": 80}'::jsonb, '{"sheet": "Cash collection summary, Oct 2026", "crv": "3863", "bank": "CBE, Awash", "collectedBy": "Nigist Tesfaye", "unitPrices": {"3EL": 28000}}'::jsonb, 'Collected · CRV 3863 · CBE, Awash · collected by Nigist Tesfaye'),
    ('2026-10-29', '29/10/2026', 'Netsanet Asefa', 2595584.5, 80.83, '{"3EL": 74.62, "5EL": 6.21}'::jsonb, '{"sheet": "Cash collection summary, Oct 2026", "crv": "3864", "bank": "CBE, Coop, Zemen", "collectedBy": "Nigist Tesfaye", "unitPrices": {"3EL": 28000, "5EL": 27000}}'::jsonb, 'Collected · CRV 3864 · CBE, Coop, Zemen · collected by Nigist Tesfaye'),
    ('2026-11-06', '6/11/2026', 'Kadisco Paint & Adhesive Industry', 241500, 10, '{"ETL9": 10}'::jsonb, '{"sheet": "Cash collection summary, Oct 2026", "crv": "3866", "bank": "Awash", "collectedBy": "Nigist Tesfaye", "unitPrices": {"ETL9": 21000}}'::jsonb, 'Collected · CRV 3866 · Awash · collected by Nigist Tesfaye'),
    ('2026-10-06', '6/10/2026', 'MC Baumiche', 1150000, 50, '{"ETL9": 50}'::jsonb, '{"sheet": "Cash collection summary, Oct 2026", "crv": "3832", "bank": "CBE", "collectedBy": "Getachew Lemma", "unitPrices": {"ETL9": 20000}}'::jsonb, 'Collected · CRV 3832 · CBE · collected by Getachew Lemma'),
    ('2026-10-21', '21/10/2026', 'MC Baumiche', 1495000, 50, '{"ETL15": 50}'::jsonb, '{"sheet": "Cash collection summary, Oct 2026", "crv": "3834", "bank": "CBE", "collectedBy": "Getachew Lemma", "unitPrices": {"ETL15": 26000}}'::jsonb, 'Collected · CRV 3834 · CBE · collected by Getachew Lemma'),
    ('2026-11-02', '2/11/2026', 'MC Baumiche', 1495000, 50, '{"ETL15": 50}'::jsonb, '{"sheet": "Cash collection summary, Oct 2026", "crv": "3835", "bank": "CBE", "collectedBy": "Getachew Lemma", "unitPrices": {"ETL15": 26000}}'::jsonb, 'Collected · CRV 3835 · CBE · collected by Getachew Lemma')
    ) as t(day, label, customer, amount, qty, products, extraction, note)
  loop
    key5 := left(lower(regexp_replace(v.customer, '[^a-zA-Z0-9]', '', 'g')), 5);

    -- A kept, unpaid sale filed from 20 Oct on: same customer, sold on or up to
    -- 7 days before the collection, with the given tonnes.
    -- (1) The whole line as one sale.
    select i.id into hit
      from sales_invoices i
     where i.invoice_credit > 0
       and i.reported_by not in ('credit statement 31 Oct 2026', 'cash collection summary Oct 2026')
       and (i.date at time zone 'Africa/Addis_Ababa')::date >= date '2026-10-20'
       and (i.date at time zone 'Africa/Addis_Ababa')::date between (v.day)::date - 7 and (v.day)::date
       and left(lower(regexp_replace(i.customer, '[^a-zA-Z0-9]', '', 'g')), 5) = key5
       and i.qty = v.qty
       and not exists (select 1 from sales_credit_payments p where p.invoice_id = i.id)
     order by i.date limit 1;

    if hit is not null then
      insert into sales_credit_payments (invoice_id, amount, collected_on, note, recorded_by)
      select hit, invoice_credit, (v.day)::date, v.note, 'cash collection summary Oct 2026' from sales_invoices where id = hit;
      raise notice '% % - paid the sale already on file', v.customer, v.label;
      continue;
    end if;

    -- (2) Each product of the line as its own kept sale; (3) the rest is added.
    left_over := '{}'::jsonb;
    left_amount := 0;
    for part in select e.key as code, (e.value)::numeric as t from jsonb_each_text(v.products) e loop
      hit := null;
      select i.id into hit
        from sales_invoices i
       where i.invoice_credit > 0
         and i.reported_by not in ('credit statement 31 Oct 2026', 'cash collection summary Oct 2026')
         and (i.date at time zone 'Africa/Addis_Ababa')::date >= date '2026-10-20'
         and (i.date at time zone 'Africa/Addis_Ababa')::date between (v.day)::date - 7 and (v.day)::date
         and left(lower(regexp_replace(i.customer, '[^a-zA-Z0-9]', '', 'g')), 5) = key5
         and i.qty = part.t
         and not exists (select 1 from sales_credit_payments p where p.invoice_id = i.id)
       order by i.date limit 1;
      if hit is not null then
        insert into sales_credit_payments (invoice_id, amount, collected_on, note, recorded_by)
        select hit, invoice_credit, (v.day)::date, v.note, 'cash collection summary Oct 2026' from sales_invoices where id = hit;
        raise notice '% % % - paid the sale already on file', v.customer, v.label, part.code;
      else
        left_over := left_over || jsonb_build_object(part.code, part.t);
        left_amount := left_amount + round(part.t * (v.extraction -> 'unitPrices' ->> part.code)::numeric * 1.15, 2);
      end if;
    end loop;

    if left_over <> '{}'::jsonb then
      with added as (
        insert into sales_invoices (date, date_label, customer, invoice_cash, invoice_credit, qty, delivery_no, products, extraction, reported_by, source)
        values ((v.day || 'T00:00:00Z')::timestamptz, v.label, v.customer, 0, left_amount,
                (select sum((e.value)::numeric) from jsonb_each_text(left_over) e), null, left_over, v.extraction, 'cash collection summary Oct 2026', 'app')
        returning id
      )
      insert into sales_credit_payments (invoice_id, amount, collected_on, note, recorded_by)
      select id, left_amount, (v.day)::date, v.note, 'cash collection summary Oct 2026' from added;
      raise notice '% % - added as collected', v.customer, v.label;
    end if;
  end loop;
end $$;

commit;

-- Check: open and collected credit, by where it came from.
select coalesce(nullif(i.reported_by, ''), '?') as filed_by, count(*) as sales, sum(i.qty) as tonnes,
       sum(i.invoice_credit) as credit,
       sum(coalesce((select sum(p.amount) from sales_credit_payments p where p.invoice_id = i.id), 0)) as paid
  from sales_invoices i where i.invoice_credit > 0 group by 1 order by 1;
