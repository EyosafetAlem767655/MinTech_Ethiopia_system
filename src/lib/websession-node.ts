import sql from "@/lib/sql";
import { generateSessionToken, type WebSessionRow } from "@/lib/websession";

/**
 * Node-only (postgres.js) side of the web-session store. The login / logout /
 * device routes run on the Node runtime, so they use the superuser postgres
 * connection here — which, unlike the Edge middleware, can run DDL. That lets the
 * store self-heal: if the web_sessions table was never migrated (0007), the first
 * login creates it, so device tracking works without a manual migration step.
 *
 * The Edge middleware validates tokens through Supabase REST in websession.ts;
 * that file must stay free of this postgres.js import or the middleware bundle
 * breaks. Keep the two sides separate.
 */

let _ensured = false;

/** Idempotently create web_sessions (mirrors migration 0007) and nudge PostgREST
 *  to reload its schema cache so the Edge middleware's REST reads can see it. */
export async function ensureWebSessionsTable(): Promise<void> {
  if (_ensured) return;
  await sql`
    create table if not exists web_sessions (
      id           uuid primary key default gen_random_uuid(),
      token        text not null unique,
      label        text,
      user_agent   text,
      ip           text,
      created_at   timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      revoked_at   timestamptz
    )
  `;
  await sql`create index if not exists web_sessions_token_idx  on web_sessions (token)`;
  await sql`create index if not exists web_sessions_active_idx on web_sessions (revoked_at)`;
  // RLS on + forced: the middleware/API use the service key (which bypasses RLS),
  // but without this an anon key could read session tokens through PostgREST.
  await sql`alter table web_sessions enable row level security`;
  await sql`alter table web_sessions force row level security`;
  // Ask PostgREST to pick up the new table so the Edge middleware can query it.
  await sql`select pg_notify('pgrst', 'reload schema')`.catch(() => {});
  _ensured = true;
}

/** Records a device and returns the new row id — that id is what the login route
 *  signs into the cookie (the per-device session handle). */
export async function createSession(input: {
  label: string;
  userAgent: string;
  ip: string;
}): Promise<string> {
  await ensureWebSessionsTable();
  const rows = await sql<{ id: string }[]>`
    insert into web_sessions (token, label, user_agent, ip)
    values (${generateSessionToken()}, ${input.label}, ${input.userAgent}, ${input.ip})
    returning id
  `;
  return rows[0].id;
}

export async function listSessions(): Promise<WebSessionRow[]> {
  await ensureWebSessionsTable();
  const rows = await sql<WebSessionRow[]>`
    select id, label, user_agent, ip, created_at, last_seen_at, revoked_at
      from web_sessions
     where revoked_at is null
     order by last_seen_at desc
  `;
  return rows as unknown as WebSessionRow[];
}

export async function revokeSession(id: string): Promise<void> {
  await sql`update web_sessions set revoked_at = now() where id = ${id}`.catch(() => {});
}
