-- Web (dashboard) sessions: per-device login tokens so the app can list the
-- browsers/devices signed in and revoke or log them out. Replaces the previous
-- stateless shared-password cookie (which had no logout and no device list).
-- Middleware validates the cookie token against this table using the Supabase
-- service key (which bypasses RLS).

create table if not exists web_sessions (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,          -- opaque random value stored in the mt_auth cookie
  label        text,                          -- friendly device label (browser · OS)
  user_agent   text,
  ip           text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);
create index if not exists web_sessions_token_idx  on web_sessions (token);
create index if not exists web_sessions_active_idx on web_sessions (revoked_at);

alter table web_sessions enable row level security;
alter table web_sessions force row level security;

-- ...and the one grant this app's Data API use depends on.
--
-- From 30 October 2025 Supabase no longer grants new tables to the Data API
-- automatically, so a table created by this migration on a new project, a
-- preview branch or a local `supabase db reset` would be unreachable over
-- /rest/v1 — which is exactly how the Edge middleware validates a login cookie.
-- RLS above still denies anon and authenticated; only the service key gets in.
grant select, insert, update, delete on public.web_sessions to service_role;
