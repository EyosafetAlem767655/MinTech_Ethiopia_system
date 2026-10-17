-- The oils, counted by the owner on 2026-10-17.
--
--   Gas oil            14 drums (1 drum = 200 litres) → kept in litres: 2,800 l
--   Engine oil 15W40    1 drum
--   Engine oil 20W50    1 drum   (the owner: "1 drum" for both engine oils)
--   Industrial oil 320  9 drums
--
-- One store_counts row for the oils only. Every other item keeps the figure it
-- had: each item reads its newest count that mentions it. Later vouchers move
-- these on from here, as from any count.
--
-- Dated at UTC midnight — the same convention every bot-filed count and voucher
-- uses. The first version wrote '2026-10-17T00:00:00+03:00', which is 21:00 UTC
-- on the 16th: it read as a count of the 16th and sorted BEHIND anything filed
-- from the bot on the 17th, so the inventory did not show it.
--
-- Recorded as made at the START of the 17th (00:00 EAT). A voucher dated the
-- same day as a count is deducted only if it was filed after the count, so a
-- count stamped "now" swallowed the three gas-oil issues (3 × 50 l) filed
-- earlier today, as if the 2,800 l had been counted after they left. Counted at
-- the start of the day, every issue dated the 17th comes off it: 2,800 − 150.
--
-- Re-runnable: it replaces its own row, whichever date that row was given.

delete from store_counts where counted_by = 'Oil count (owner)';

insert into store_counts (date, date_label, groups, items, counted_by, source, created_at)
values ('2026-10-17T00:00:00Z', '2026-10-17',
        array['oil']::text[],
        '{"oil:gas":2800,"oil:engine-15w40":1,"oil:engine-20w50":1,"oil:industrial-320":9}'::jsonb,
        'Oil count (owner)', 'app', '2026-10-17T00:00:00+03:00');

-- Check: the newest count of each of the four oils, and who filed it. Each
-- line should name 'Oil count (owner)' with the figure above; a later count
-- from the bot that also covered an oil would show here by name instead.
select distinct on (k.key) k.key, c.items -> k.key as qty, c.date_label, c.counted_by, c.created_at
  from (values ('oil:gas'), ('oil:engine-15w40'), ('oil:engine-20w50'), ('oil:industrial-320')) as k(key)
  join store_counts c on c.items ? k.key
 order by k.key, c.date desc, c.created_at desc;

-- Check: the gas oil issued since the count — each is deducted from 2,800 l.
-- An issue missing here was not linked to Gas OIL (oil:gas) on its voucher.
select v.siv_no, v.date::date as voucher_date, i.description, i.ledger_qty as litres, v.created_at
  from store_issue_items i
  join store_issue_vouchers v on v.id = i.siv_id
 where i.ledger_kind = 'store' and i.ledger_key = 'oil:gas' and v.date >= '2026-10-17'
 order by v.created_at;
