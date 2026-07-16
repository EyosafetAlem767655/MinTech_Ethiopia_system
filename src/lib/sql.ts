import postgres from "postgres";

/**
 * Postgres connection to Supabase.
 *
 * Must point at the **transaction pooler** (Supavisor, port 6543), not the
 * direct connection (5432). The direct host resolves to IPv6 only and Vercel is
 * IPv4, so pointing at it makes every request hang until the function times out
 * (a 504) rather than failing fast.
 *
 * `prepare: false` is not optional — the transaction pooler assigns a different
 * backend per statement, so server-side prepared statements can't be reused.
 *
 * The client is created lazily and cached on globalThis. Lazily matters twice
 * over: `next build` imports these modules, and an eager connection would make
 * the build itself require SUPABASE_DB_URL; and a missing variable now surfaces
 * as a readable per-request error instead of a module-load crash.
 */

declare global {
  // eslint-disable-next-line no-var
  var _sql: postgres.Sql | undefined;
}

function client(): postgres.Sql {
  if (global._sql) return global._sql;

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Use the Supabase transaction pooler string (port 6543) from Connect → Transaction pooler."
    );
  }

  global._sql = postgres(url, {
    prepare: false,
    // Not 1. The dashboard fans out ~12 queries through Promise.all; with a
    // single connection postgres.js queues them and they run strictly one after
    // another, which is what pushed the route past the function time limit.
    // Supavisor's transaction mode multiplexes, so holding a few client
    // connections is exactly what the pooler is there for.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null },
  });
  return global._sql;
}

/**
 * Lazy proxy around the postgres.js client. `sql\`...\`` hits the apply trap;
 * `sql.json(...)` / `sql.begin(...)` hit the get trap. Behaves exactly like the
 * real client, but nothing connects until the first query.
 */
export const sql: postgres.Sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply(_target, _thisArg, args: unknown[]) {
    return (client() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    const c = client() as unknown as Record<string | symbol, unknown>;
    const value = c[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(c) : value;
  },
}) as postgres.Sql;

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
