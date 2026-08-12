-- Sales report format change: the Cash Sales layout is replaced by the simpler
-- agreed columns (Date, Customer, Product/Qty, Unit Price, Sub Total, VAT 15%,
-- Grand Total, Withholding, Net Payable, Remark). Only a Remark column is new;
-- the dropped fields (fs_no, att_no, deposited_bank) are simply no longer written
-- and stay nullable, so no data is lost.

alter table sales_receipts
  add column if not exists remark text;
