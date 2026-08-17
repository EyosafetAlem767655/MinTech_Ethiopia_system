-- Release sales reports stranded in 'processed'.
--
-- The bot used to save an approved sales report as 'processed' and only promote
-- it to 'submitted' when the salesperson additionally pressed "📤 ወደ ዳሽቦርድ
-- አስገባ". Everything on the web side — the dashboard Sales tab, the "Sales today"
-- card in the brief, the Excel export — filters on status = 'submitted', so any
-- report where that second button was never pressed was invisible even though
-- the salesperson had filed it.
--
-- Approving on the bot now publishes directly, and these are the rows that were
-- filed under the old two-step flow.

update sales_receipts
   set status = 'submitted', updated_at = now()
 where status = 'processed';
