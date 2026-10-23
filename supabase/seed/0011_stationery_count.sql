-- The stationery items' latest count (October 2026), from the owner's list.
--
-- One store_counts row for the stationery group only. Every other item keeps
-- its own newest count. Pads are counted in pads, paper and carbon in reams,
-- everything else in pieces. Later GRVs (received) and stationery issue
-- vouchers (taken) move these on from here, as from any count.
--
-- Re-runnable: it replaces its own row.

delete from store_counts where counted_by = 'Stationery count (owner)';

insert into store_counts (date, date_label, groups, items, counted_by, source, created_at)
values ('2026-10-23T00:00:00Z', '2026-10-23',
        array['stat']::text[],
        '{"stat:get-pass": 50, "stat:finished-goods-transfer-vo": 16, "stat:delivery-note": 50, "stat:finished-goods-receiving-vo": 19, "stat:material-receiving-vo": 26, "stat:temporary-raw-material-receiving-vo": 26, "stat:purchase-requistion-vo": 12, "stat:store-requistion-note": 19, "stat:goods-receiving-voucher": 9, "stat:cash-sales-attachement": 30, "stat:credit-sales-attachement": 55, "stat:fixed-asset-receiving-vo": 10, "stat:jornal-voucher": 5, "stat:purchase-order": 8, "stat:store-issue-vo": 21, "stat:petty-cash-payment-vo": 30, "stat:delivery-order": 45, "stat:receipt-for-withholding-vo": 13, "stat:non-stock-items-receiving-issue-vo": 6, "stat:credit-sales-invoice": 53, "stat:cash-sale-invoice": 49, "stat:cash-recipient-vo": 11, "stat:bin-card": 0, "stat:finished-product-other-goods-dispatch": 9, "stat:finished-product-other-goods-get-pass": 4, "stat:purchase-voucher": 31, "stat:check-payment-voucher": 210, "stat:with-holding-tax-on-payment-active": 16, "stat:credit-sales-invoice-vat": 19, "stat:cash-sales-invoice-vat-active": 28, "stat:receipt-invoice-active": 48, "stat:purchase-voucher-active": 98, "stat:proforma-invoice": 31, "stat:heded-kaki-envelope-postal-a4": 210, "stat:heded-white-envelope-postal": 290, "stat:inter-office-memo": 68, "stat:credit-note": 0, "stat:stapler-wire": 13, "stat:ball-point-pen": 469, "stat:fastener": 3, "stat:heded-carbon": 5, "stat:photo-copy-paper": 29, "stat:box-file": 78, "stat:flat-file": 84, "stat:registration-book-big": 6, "stat:registration-book-small": 5, "stat:writing-pad": 14, "stat:pencil": 26, "stat:eraser": 2, "stat:heded-letter": 0, "stat:note-book-small": 19, "stat:marker": 0, "stat:correction-fluid": 25}'::jsonb,
        'Stationery count (owner)', 'app', '2026-10-23T00:00:00+03:00');

-- Check: the row and how many items it carries (53).
select date_label, counted_by, (select count(*) from jsonb_object_keys(items)) as items
  from store_counts where counted_by = 'Stationery count (owner)';
