-- Two small columns, for two things that were previously invisible.

/* ── 1. Was the store issue voucher's photo checked against what was typed? ── */

-- The store issue flow asks its questions first and photographs the voucher
-- last. This holds the comparison: what the model read, and where it disagreed.
--
-- Deliberately advisory. The typed figures are the record — the person was
-- standing in the store with the items — and nothing here ever rewrites them.
-- `checked: false` is its own outcome, meaning the read did not happen, never
-- that the voucher is wrong.
alter table store_issue_vouchers
  add column if not exists verification jsonb;

/* ── 2. Which gateway route actually delivered a WHT chase? ────────────────── */

-- The Traccar gateway is reachable two ways: the cloud relay, which is what a
-- serverless cron can reach, and the phone's own address on the office Wi-Fi,
-- which it usually cannot. Recording which one succeeded is what makes "it says
-- it sent but nothing arrived" a question anybody can answer.
alter table wht_sms_log
  add column if not exists route text;
