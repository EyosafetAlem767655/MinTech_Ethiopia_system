-- Web (dashboard) users with a role. Safe to run any number of times.
--
-- Three ways into the dashboard:
--   Super Admin     — the ADMIN_PASSWORD in Vercel. Everything, including
--                     managing the people below. Not a row here.
--   Chief Manager   — a personal account. Can edit submissions; cannot manage
--                     web users, delete or purge, or open the system pages.
--   HR Manager      — a personal account. Views everything, changes nothing
--                     (the AI chat and exports still work).
--
-- The Super Admin creates each account (name + role + password) and can revoke
-- it. A revoked account cannot log in, and its open sessions are revoked with
-- it. Passwords are scrypt hashes, the same as the bot's.

create table if not exists web_users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  role          text not null check (role in ('chief', 'hr')),
  phone         text,
  email         text,
  password_hash text not null,
  revoked_at    timestamptz,
  created_by    text not null default 'Super Admin',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists web_users_name_key on web_users (lower(name));

-- Which person (and role) each signed-in device belongs to. Null = Super Admin.
alter table web_sessions add column if not exists user_id uuid references web_users(id) on delete cascade;
alter table web_sessions add column if not exists role    text;
create index if not exists web_sessions_user_idx on web_sessions (user_id);

alter table web_users enable row level security;
alter table web_users force  row level security;
