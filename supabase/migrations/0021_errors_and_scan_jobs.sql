-- Making failures visible, and taking the receipt read out of the reply path.
--
-- Both exist because of the same incident: a salesperson saw
-- "Gemini timed out after 8000ms" on their phone, and that message was the ONLY
-- record it ever happened. Nothing was logged, nobody was told, and the batch of
-- receipts behind it was simply lost.

/* ────────────────────────────── 1. Error log ──────────────────────────────── */

create table if not exists system_errors (
  id         uuid primary key default gen_random_uuid(),
  -- Where it happened: 'llm', 'telegram-webhook', 'cron/finance-daily', …
  source     text not null,
  -- A STABLE slug, not the message: 'gemini_timeout', 'gemini_http_404'.
  -- Alerts are rate-limited per kind, so a kind that embeds a varying detail
  -- (an id, a duration) would defeat the rate limit and flood the admins.
  kind       text not null,
  message    text not null,
  detail     jsonb,
  -- Who was affected, when it happened inside someone's flow.
  actor      text,
  chat_id    text,
  created_at timestamptz not null default now(),
  -- Set from the dashboard once someone has dealt with it.
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists system_errors_created_idx on system_errors (created_at desc);
create index if not exists system_errors_open_idx    on system_errors (created_at desc)
  where resolved_at is null;
-- Backs the "have we already alerted about this kind in the last hour?" check.
create index if not exists system_errors_kind_idx    on system_errors (kind, created_at desc);

/* ─────────────────────── 2. Sales receipt read jobs ───────────────────────── */

-- One job per SALE, not per photo: a sale's main receipt, its WHT receipt and
-- any bank slip are read together and merged into one row, because that is what
-- they describe between them.
--
-- The job exists so the webhook can answer immediately. A provider call in the
-- reply path is what leaves an update unacknowledged, and an unacknowledged
-- update is redelivered by Telegram forever.
create table if not exists sales_scan_jobs (
  id          uuid primary key default gen_random_uuid(),
  chat_id     text not null,
  reported_by text not null,
  -- The date chosen from the calendar at the start of the day's session; the
  -- receipts may be photographed hours later and must not drift onto today.
  sale_date   text not null,
  photo_file_ids uuid[] not null default '{}',
  -- pending → reading → done | failed
  status      text not null default 'pending'
              check (status in ('pending', 'reading', 'done', 'failed')),
  attempts    integer not null default 0,
  -- The merged draft, once read.
  result      jsonb,
  error       text,
  -- When the current 'reading' claim was taken. The sweep uses this to find
  -- jobs whose worker was killed mid-read.
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sales_scan_jobs_status_idx on sales_scan_jobs (status, created_at);
create index if not exists sales_scan_jobs_chat_idx   on sales_scan_jobs (chat_id, created_at desc);
