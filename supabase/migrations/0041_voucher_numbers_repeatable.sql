-- Voucher numbers may repeat.
--
-- 0019 made a GRV / SIV number unique, on the reasoning that filing the same
-- voucher twice doubles a stock movement. In practice the paper pads restart
-- their numbering, so a perfectly real voucher arrived with a number already on
-- file — and was refused at the very last step, every time it was retried. The
-- submission sat stuck on the review card and never reached the dashboard.
--
-- By the owner's decision the numbers are now just a reference. The protection
-- against a voucher being saved twice moved to where it belongs: the save is one
-- transaction (header, lines and any new store items together, or none of
-- them), and a second ✅ tap while a save is running is refused by the bot.

drop index if exists siv_no_unique_idx;
drop index if exists grv_no_unique_idx;

-- Still looked up by number (the dashboard search, the chat), so still indexed.
create index if not exists siv_no_idx on store_issue_vouchers (siv_no);
create index if not exists grv_no_idx on goods_receiving_vouchers (grv_no);
