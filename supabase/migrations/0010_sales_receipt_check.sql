-- Receipt authenticity + cross-check verdict for sales reports. When a sales row
-- is submitted with an attached receipt photo, the bot runs an AI legitimacy
-- check and extracts the receipt's figures, comparing them to the entered values.
-- The verdict is stored here and shown as a badge on the dashboard Sales tab.
--
-- Shape: { score:int(0-100), flags:text[], reasoning:text,
--          extracted:{productTy,qty,unitPrice,grandTotal}|null, mismatches:text[] }

alter table sales_receipts
  add column if not exists receipt_check jsonb;
