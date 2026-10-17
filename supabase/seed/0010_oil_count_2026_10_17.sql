-- The oils, counted by the owner on 2026-10-17.
--
--   Gas oil            14 drums (1 drum = 200 litres) → kept in litres: 2,800 l
--   Engine oil 15W40    1 drum
--   Engine oil 20W50    1 drum   (the owner: "1 drum" for both engine oils)
--   Industrial oil 320  9 drums
--
-- One store_counts row for the oils only. Every other item keeps the figure it
-- had: each item reads its newest count that mentions it. Later vouchers move
-- these on from here, as from any count. Re-runnable: it replaces its own row.

delete from store_counts where counted_by = 'Oil count (owner)' and date_label = '2026-10-17';

insert into store_counts (date, date_label, groups, items, counted_by, source)
values ('2026-10-17T00:00:00+03:00', '2026-10-17',
        array['oil']::text[],
        '{"oil:gas":2800,"oil:engine-15w40":1,"oil:engine-20w50":1,"oil:industrial-320":9}'::jsonb,
        'Oil count (owner)', 'app');
