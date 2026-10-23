-- UNDO of the PP bag manufacturer split (seed 0013 / migration 0046).
--
-- Puts every PP bag figure back to one plain kind per size and colour, the way
-- it was before: "kg40:Yellow@ethio-india" → "kg40:Yellow", and the nested
-- counts { kg40: { "Yellow@ethio-india": n } } → { kg40: { Yellow: n } }. Where
-- both spellings exist on one row they are added together. Bags filed under a
-- company typed with "Other" are folded back the same way.
--
-- Only needed if 0046 or 0013 were run. Safe to run more than once, and safe to
-- run if they never were (it then changes nothing).
--
-- Touches ONLY figures dated before 23 Oct 2026 (and the October opening
-- balance, which 0015 never writes). From that day PP bags are
-- kept per company for real (seed 0015), and those figures are left alone.

begin;

-- Nested counts: daily bag counts and the PP bag receiving form.
update daily_ops_reports
   set bags = (
     select coalesce(jsonb_object_agg(s.key,
              case when jsonb_typeof(s.value) = 'object' then
                (select coalesce(jsonb_object_agg(c.colour, c.n), '{}'::jsonb)
                   from (select split_part(e.key, '@', 1) as colour, sum((e.value)::numeric) as n
                           from jsonb_each(s.value) e group by 1) c)
              else s.value end), '{}'::jsonb)
       from jsonb_each(bags) s)
 where bags::text like '%@%' and date < '2026-10-23';

update pp_bag_purchases
   set bags = (
     select coalesce(jsonb_object_agg(s.key,
              case when jsonb_typeof(s.value) = 'object' then
                (select coalesce(jsonb_object_agg(c.colour, c.n), '{}'::jsonb)
                   from (select split_part(e.key, '@', 1) as colour, sum((e.value)::numeric) as n
                           from jsonb_each(s.value) e group by 1) c)
              else s.value end), '{}'::jsonb)
       from jsonb_each(bags) s)
 where bags::text like '%@%' and date < '2026-10-23';

-- Flat maps keyed "kg40:Yellow@…": the opening balance (added together).
update monthly_base_balances
   set bags = (
     select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
       from (select split_part(e.key, '@', 1) as k, sum((e.value)::numeric) as n
               from jsonb_each(bags) e group by 1) x)
 where bags::text like '%@%' and month <= '2026-10';

-- Prices: the company copies are dropped; the plain kind keeps its price.
update monthly_price_lists
   set prices = (
     select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
       from jsonb_each(prices) e where e.key not like '%@%')
 where prices::text like '%@%' and month < '2026-10';

-- Line items.
update pp_bag_usage_items i set ledger_key = split_part(i.ledger_key, '@', 1)
  from pp_bag_usage u
 where u.id = i.usage_id and i.ledger_key like '%@%' and u.date < '2026-10-23';
update pp_bag_damage_items i set ledger_key = split_part(i.ledger_key, '@', 1)
  from pp_bag_damage_reports r
 where r.id = i.report_id and i.ledger_key like '%@%' and r.date < '2026-10-23';
update goods_receiving_items i set ledger_key = split_part(i.ledger_key, '@', 1)
  from goods_receiving_vouchers v
 where v.id = i.grv_id and i.ledger_kind = 'bag' and i.ledger_key like '%@%' and v.date < '2026-10-23';
update store_issue_items i set ledger_key = split_part(i.ledger_key, '@', 1)
  from store_issue_vouchers v
 where v.id = i.siv_id and i.ledger_kind = 'bag' and i.ledger_key like '%@%' and v.date < '2026-10-23';

-- The company list itself.
drop table if exists pp_bag_companies;

commit;

-- Check: the latest bag count, back to plain colours.
select date_label, bags
  from daily_ops_reports
 where bags is not null and bags::text <> '{}'
 order by date desc limit 1;
