import postgres from "postgres";

/**
 * Postgres connection to Supabase.
 *
 * Must point at the **transaction pooler** (Supavisor, port 6543), not the
 * direct connection (5432): Vercel lambdas are short-lived and numerous, and
 * the direct connection would exhaust Postgres' backend slots. The pooler is
 * what makes serverless + Postgres viable.
 *
 * `prepare: false` is not optional — the transaction pooler assigns a different
 * backend per statement, so server-side prepared statements cannot be reused
 * and postgres.js must send everything as a simple query.
 *
 * The connection is cached on globalThis so Next.js hot reloads (and warm
 * lambda invocations) reuse one client, mirroring what src/lib/db.ts used to do
 * for Mongoose.
 */

declare global {
  // eslint-disable-next-line no-var
  var _sql: postgres.Sql | undefined;
}

function create(): postgres.Sql {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");

  return postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // Mongo returned plain JS objects; keep jsonb round-tripping the same way.
    transform: { undefined: null },
  });
}

export const sql: postgres.Sql = global._sql ?? (global._sql = create());
export default sql;

/**
 * Wraps a value as a jsonb parameter. postgres.js's `sql.json` types its
 * argument as a strict JSONValue, which `Record<string, unknown>` and other
 * loosely-typed app objects don't satisfy — this keeps the call sites clean.
 */
export function jsonb(value: unknown) {
  return sql.json(value as never);
}

/** True when the row set is empty — reads a touch better than `.length === 0`. */
export function first<T>(rows: readonly T[]): T | null {
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Ids are uuids, handed to the browser as opaque strings. A malformed value
 * must be rejected before it reaches Postgres, or it raises a type error that
 * surfaces as a 500 instead of a clean 404.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
