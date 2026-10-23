-- The PP bag manufacturer, from the latest count on (October 2026).
--
-- The owner's word: the current stock of Yellow 40KG — 26,000 on hand — is
-- Ethio-India; every other bag is Great Wall Packaging. From here on, what
-- comes in and goes out is recorded with its company. Bags carry their company in
-- their key from migration 0046 on — "kg40:Yellow" is Great Wall and
-- "kg40:Yellow@ethio-india" is Ethio-India — so this relabels the Yellow 40KG
-- figures of October 2026 onward, in every table that holds them, so the month's
-- opening, receipts, usage, damage and counts all agree on the company.
-- Months before October keep their figures exactly as they were signed off.
--
-- Run after migration 0046. Re-runnable: a figure already relabelled has no
-- plain "Yellow" left to move.

begin;

-- Daily counts (production's bag block): { kg40: { Yellow: n } } → { kg40: { "Yellow@ethio-india": n } }
update daily_ops_reports
   set bags = jsonb_set(bags, '{kg40}',
                (bags->'kg40') - 'Yellow'
                || jsonb_build_object('Yellow@ethio-india',
                     coalesce((bags->'kg40'->>'Yellow@ethio-india')::numeric, 0) + (bags->'kg40'->>'Yellow')::numeric))
 where date >= '2026-10-01'
   and jsonb_typeof(bags->'kg40') = 'object'
   and bags->'kg40' ? 'Yellow';

-- Deliveries on the PP bag receiving form, same nested shape.
update pp_bag_purchases
   set bags = jsonb_set(bags, '{kg40}',
                (bags->'kg40') - 'Yellow'
                || jsonb_build_object('Yellow@ethio-india',
                     coalesce((bags->'kg40'->>'Yellow@ethio-india')::numeric, 0) + (bags->'kg40'->>'Yellow')::numeric))
 where date >= '2026-10-01'
   and jsonb_typeof(bags->'kg40') = 'object'
   and bags->'kg40' ? 'Yellow';

-- The opening balance of October onward: { "kg40:Yellow": n } → { "kg40:Yellow@ethio-india": n }
update monthly_base_balances
   set bags = (bags - 'kg40:Yellow')
              || jsonb_build_object('kg40:Yellow@ethio-india',
                   coalesce((bags->>'kg40:Yellow@ethio-india')::numeric, 0) + (bags->>'kg40:Yellow')::numeric)
 where month >= '2026-10' and bags ? 'kg40:Yellow';

-- Usage and damage lines.
update pp_bag_usage_items i
   set ledger_key = 'kg40:Yellow@ethio-india'
  from pp_bag_usage u
 where u.id = i.usage_id and u.date >= '2026-10-01' and i.ledger_key = 'kg40:Yellow';

update pp_bag_damage_items i
   set ledger_key = 'kg40:Yellow@ethio-india'
  from pp_bag_damage_reports r
 where r.id = i.report_id and r.date >= '2026-10-01' and i.ledger_key = 'kg40:Yellow';

-- Voucher lines classified as Yellow 40KG bags.
update goods_receiving_items i
   set ledger_key = 'kg40:Yellow@ethio-india'
  from goods_receiving_vouchers v
 where v.id = i.grv_id and v.date >= '2026-10-01' and i.ledger_kind = 'bag' and i.ledger_key = 'kg40:Yellow';

update store_issue_items i
   set ledger_key = 'kg40:Yellow@ethio-india'
  from store_issue_vouchers v
 where v.id = i.siv_id and v.date >= '2026-10-01' and i.ledger_kind = 'bag' and i.ledger_key = 'kg40:Yellow';

-- The price the Yellow 40KG carried this month is Ethio-India's price. Copied,
-- not moved: Great Wall keeps a Yellow 40KG price line to fill in when needed.
update monthly_price_lists
   set prices = prices || jsonb_build_object('kg40:Yellow@ethio-india', prices->'kg40:Yellow')
 where month >= '2026-10' and prices ? 'kg40:Yellow' and not prices ? 'kg40:Yellow@ethio-india';

-- The current stock, as the owner states it: the 26,000 Yellow 40KG on hand
-- are Ethio-India's, everything else is Great Wall's. Written into the latest
-- bag count so the stock reads exactly that; additions and withdrawals are
-- tracked per company from here.
update daily_ops_reports
   set bags = jsonb_set(bags, '{kg40}',
                coalesce(bags->'kg40', '{}'::jsonb) - 'Yellow' || '{"Yellow@ethio-india": 26000}'::jsonb)
 where id = (select id from daily_ops_reports
              where bags is not null and bags::text <> '{}'
              order by date desc, created_at desc limit 1);

commit;

-- Check: the latest count per company for 40KG bags — Ethio-India's Yellow should read 26,000.
select date_label, bags->'kg40' as kg40
  from daily_ops_reports
 where bags is not null and bags::text <> '{}'
 order by date desc limit 1;
