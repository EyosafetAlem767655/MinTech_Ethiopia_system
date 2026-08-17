-- Asset management reconstruction + the dashboard chat quota.
--
-- The asset tables from 0006 stay exactly as they are; the bot simply stops
-- guessing their contents with an LLM and asks for the columns directly. Only
-- three shape changes are needed.

/* ── Delivery reports ───────────────────────────────────────────────────────
   The sheet has TWO money columns — how much of the delivery was invoiced in
   cash and how much on credit — not one amount plus a cash/credit flag. The old
   invoice_no / payment_type columns stay: rows filed before this migration use
   them, and dropping them would silently blank historic reports. */
alter table delivery_reports
  add column if not exists invoice_cash   numeric(14,2),
  add column if not exists invoice_credit numeric(14,2);

/* ── Tool purchase requests ─────────────────────────────────────────────────
   `kind` splits the two flows the asset manager picks between: a maintenance
   request carries a photo of the damaged item (checked by Gemini, verdict stored
   in the existing `legitimacy` jsonb), a new-item request carries a written
   reason in `justification`.

   `amount` becomes nullable because the requested flow never asks for a price —
   the asset manager states what is needed and how many, and costing happens
   later. Leaving it NOT NULL would force the bot to invent a zero. */
alter table purchase_requests
  add column if not exists quantity numeric(14,3),
  add column if not exists kind     text;

alter table purchase_requests alter column amount drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchase_requests_kind_check'
  ) then
    alter table purchase_requests
      add constraint purchase_requests_kind_check
      check (kind is null or kind in ('maintenance','new_item'));
  end if;
end $$;

/* ── Guided-flow scratch state ──────────────────────────────────────────────
   Mirrors capture/draft/receipt_scan: the in-progress asset report lives here
   between messages. Without it a multi-step flow resets to the menu on every
   reply. src/lib/sessions.ts self-heals this column too, so the bot keeps
   working if this migration has not been applied by hand yet. */
alter table telegram_sessions
  add column if not exists asset_flow jsonb;

/* ── Dashboard chat quota ───────────────────────────────────────────────────
   One row per user per EAT calendar day. The day is stored as a date rather
   than a timestamp so "10 per day" is a plain primary-key lookup and the reset
   needs no cron — a new day simply has no row yet. */
create table if not exists ai_chat_usage (
  actor      text    not null,
  day        date    not null,
  used       integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (actor, day)
);

create index if not exists ai_chat_usage_day_idx on ai_chat_usage (day);
