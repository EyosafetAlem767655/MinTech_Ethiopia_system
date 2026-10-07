-- A record of every scheduled job, so "did it run?" has an answer.
--
-- Until now the only trace a scheduled job left was its HTTP response, which
-- nothing kept. The nightly backup to Neon runs in GitHub Actions and wrote
-- nothing back here at all. So a job that silently stopped — a secret expired,
-- a cron dropped from the config — looked exactly like a job that was working.
--
-- One row per run. The System Admin view in the bot and the morning summary
-- both read from here, and a job that has NO row when one is due is reported
-- as missing: silence is a failure, not a success.

create table if not exists system_jobs (
  id          uuid primary key default gen_random_uuid(),
  -- A stable name: 'backup', 'archive', 'purge-photos', 'daily-brief', …
  job         text not null,
  started_at  timestamptz not null default now(),
  -- Null while running. A row that stays null was killed mid-run (a function
  -- timeout), which the status view reports as such.
  finished_at timestamptz,
  ok          boolean,
  -- One line a person can read in Telegram.
  summary     text,
  -- The figures behind the summary: rows moved per table, sizes, counts.
  detail      jsonb,
  -- Where it ran: 'vercel' for the app's crons, 'github' for the Actions jobs.
  source      text not null default 'vercel'
);

create index if not exists system_jobs_job_idx on system_jobs (job, started_at desc);

-- Same posture as every other table here: no Data API, no policies.
-- See 0031_data_api_lockdown.sql for why this is load-bearing.
alter table system_jobs enable row level security;
alter table system_jobs force  row level security;
