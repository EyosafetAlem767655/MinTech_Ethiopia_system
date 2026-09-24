-- Close the Data API on every table 0001 did not cover.
--
-- Supabase's notice of 30 October 2025 says new tables in `public` will no
-- longer be granted to the Data API automatically. For THIS app that changes
-- nothing: every business table is read and written with raw SQL over the
-- transaction pooler as the `postgres` role (src/lib/sql.ts), never through
-- PostgREST, supabase-js or GraphQL. The single exception is `web_sessions`,
-- which Edge middleware PATCHes over /rest/v1 with the SERVICE key, because
-- postgres.js cannot run in the Edge runtime (src/lib/websession.ts).
--
-- Reading the notice, however, exposed something that does matter. 0001 ended
-- with RLS + `revoke all … from anon, authenticated` over the 21 tables that
-- existed then, and the comment there explains why: PostgREST is a second door
-- into the data that bypasses this app's middleware entirely. NOTHING SINCE HAS
-- DONE IT. Every table added in 0006–0030 — sales_invoices, sales_credit_payments,
-- the two vouchers, whiteness_checks, system_errors, telegram_users' sessions,
-- the finance tables — was created while Supabase still granted the Data API
-- automatically, and with no RLS to deny it. This file closes that door.
--
-- Safe to run repeatedly, and safe for the app: the `postgres` role it connects
-- as has BYPASSRLS, which is why the 21 tables 0001 locked down have worked
-- exactly as before ever since.
--
-- RULE FOR EVERY FUTURE MIGRATION: a new table gets RLS and NO grants. Add a
-- `grant` only when something genuinely reads that table over the Data API, and
-- say in a comment what does. If you add tables before 30 October, run this file
-- again afterwards — until that date Supabase is still handing out the grants
-- this revokes.

/* ── 1. The one table that really is read over the Data API ───────────────── */

-- Stated rather than inherited, so a fresh project, a preview branch or a local
-- `supabase db reset` — none of which will carry the old automatic grant — can
-- still validate a login cookie. Without this the middleware fails open and
-- every dashboard session is accepted unchecked.
grant select, insert, update, delete on public.web_sessions to service_role;

/* ── 2. Nothing else is reachable with the publishable key ────────────────── */

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

/* ── 3. RLS with zero policies = deny-all, on every table that lacks it ───── */

-- Enumerated from the catalogue rather than a hand-written list on purpose: a
-- list is what drifted in the first place. Tables that already have it (the 21
-- from 0001, web_sessions from 0007) are skipped, so nothing is disturbed.
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not (c.relrowsecurity and c.relforcerowsecurity)
     order by c.relname
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('alter table public.%I force row level security',  t.relname);
    raise notice 'Data API closed on public.%', t.relname;
  end loop;
end $$;

-- Views inherit the RLS of their base tables; belt-and-braces, as in 0001.
revoke all on v_lot_balances from anon, authenticated;
