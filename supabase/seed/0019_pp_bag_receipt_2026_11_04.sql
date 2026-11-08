-- SUPERSEDED by seed 0021. Do not use.
--
-- This used to enter the 42,500 25KG White · Ethio-India bags received on
-- 4 Nov 2026 by hand. The team has since filed that delivery itself, so the
-- hand-entered copy counted it twice. Kept only so running it again does no
-- harm: it now just removes its own row.

delete from pp_bag_purchases where supplier = 'Ethio-India (entered by hand, 4 Nov 2026)';
