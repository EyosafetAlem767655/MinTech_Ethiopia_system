-- Telegram update de-duplication.
--
-- Telegram redelivers an update until the webhook answers 200. If a handler is
-- killed mid-flight (a slow AI call running past the serverless time limit), the
-- same update arrives again, re-enters the same branch, and is killed again — an
-- endless loop that spams the user roughly once a minute. That is exactly what
-- the sales receipt scanner was doing.
--
-- Claiming the update_id before any work makes the handler idempotent: a
-- redelivery loses the insert race and is acknowledged without being re-run.
-- A dedicated table (rather than a column on telegram_sessions) gives
-- exactly-once semantics that survive concurrent updates — a media group arrives
-- as several updates at once, on separate serverless instances.

create table if not exists telegram_updates (
  update_id  bigint primary key,
  chat_id    text,
  created_at timestamptz not null default now()
);

-- Rows are only useful for as long as Telegram will retry (minutes). The index
-- supports the daily purge in /api/cron/purge-photos.
create index if not exists telegram_updates_created_idx on telegram_updates (created_at);
