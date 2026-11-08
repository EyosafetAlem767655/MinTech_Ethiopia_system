-- Take out the two PP bag entries that were entered by hand and are now counted twice.
--
--   * 25KG White · Ethio-India: the 42,500 received on 4 Nov is now also on file
--     from the team, so seed 0019's copy made the stock check expect 120,533 and
--     show a gap of -42,500. The real count is 78,033.
--   * 40KG Green · Great Wall: the 3,000 used on 7 Nov is now also on file from
--     the team, so seed 0020's copy took them off twice (expected 2,100, gap
--     +3,000). The real expected count is 5,100.
--
-- Only the two hand-entered rows go; everything the team filed stays. Safe to
-- run again (it then removes nothing).

begin;

delete from pp_bag_purchases where supplier = 'Ethio-India (entered by hand, 4 Nov 2026)';

delete from pp_bag_usage_items where reference_no = 'entered by hand (7/11)';

-- The day header seed 0020 created, only if it is now empty and was its own.
delete from pp_bag_usage u
 where u.date_label = '7/11/2026' and u.source = 'app'
   and not exists (select 1 from pp_bag_usage_items i where i.usage_id = u.id);

commit;

-- Check: what is now on file for the two kinds in November (each should appear once).
select 'received' as what, p.date, p.bags, p.reported_by
  from pp_bag_purchases p
 where p.date >= '2026-11-01' and p.bags::text like '%White@ethio-india%'
union all
select 'used', u.date, jsonb_build_object(i.ledger_key, i.quantity), u.reported_by
  from pp_bag_usage_items i join pp_bag_usage u on u.id = i.usage_id
 where u.date >= '2026-11-01' and i.ledger_key = 'kg40:Green@great-wall';
