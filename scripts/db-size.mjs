import postgres from "postgres";
import { loadEnv } from "./load-env.mjs";

/**
 * What the database actually weighs, table by table.
 *
 *   npx vercel env pull .env.local --environment=production
 *   npm run db:size
 *
 * This exists because "we might run out of storage" is a worry, and a worry is
 * not a number. Before anything is archived, sharded or copied elsewhere, it is
 * worth knowing which three tables hold everything — in this system it is
 * unlikely to be the ones carrying the figures, since a year of daily production
 * is 365 rows and a photograph is a megabyte.
 *
 * Read-only. It touches nothing but the catalogue and, if it is allowed to, the
 * storage object index.
 *
 * Point it at any Postgres: `SUPABASE_DB_URL=<neon url> npm run db:size` is how
 * you check that a restored copy is the same size as the original.
 */
loadEnv();

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set. Run `npx vercel env pull .env.local --environment=production` first.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 10 });

const mb = (bytes) => `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

try {
  const [{ size }] = await sql`select pg_database_size(current_database()) as size`;

  /* reltuples is the planner's ESTIMATE, not a count. Deliberate: count(*) on
     every table in one go is a table scan per table, and an estimate is the
     right precision for "which of these is large". */
  const tables = await sql`
    select c.relname                        as name,
           pg_total_relation_size(c.oid)    as total,
           pg_relation_size(c.oid)          as heap,
           pg_indexes_size(c.oid)           as indexes,
           greatest(c.reltuples, 0)::bigint as rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
     order by pg_total_relation_size(c.oid) desc
  `;

  console.log(`\nDatabase: ${mb(size)} in ${tables.length} tables\n`);
  console.log(`  ${pad("table", 32)} ${rpad("total", 10)} ${rpad("rows", 10)} ${rpad("indexes", 10)}`);
  console.log(`  ${"-".repeat(32)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)}`);
  for (const t of tables) {
    if (Number(t.total) === 0) continue;
    console.log(`  ${pad(t.name, 32)} ${rpad(mb(t.total), 10)} ${rpad(Number(t.rows).toLocaleString(), 10)} ${rpad(mb(t.indexes), 10)}`);
  }

  /* The photographs. These are NOT in the database and NOT in a pg_dump — they
     live in Supabase Storage, which is the one part of this system a dump does
     not protect. Worth printing beside the tables precisely because it is the
     number most likely to be the large one. */
  try {
    const buckets = await sql`
      select bucket_id                                        as bucket,
             count(*)                                         as objects,
             coalesce(sum((metadata->>'size')::bigint), 0)     as bytes
        from storage.objects
       group by bucket_id
       order by bytes desc
    `;
    if (buckets.length === 0) {
      console.log(`\nStorage: no objects.`);
    } else {
      console.log(`\nStorage (NOT included in a pg_dump — see docs/RUNBOOK-failover.md):`);
      for (const b of buckets) {
        console.log(`  ${pad(b.bucket, 32)} ${rpad(mb(b.bytes), 10)} ${rpad(Number(b.objects).toLocaleString() + " files", 16)}`);
      }
    }
  } catch (e) {
    console.log(`\nStorage: could not be read (${e.message.split("\n")[0]}) — check it in the Supabase dashboard instead.`);
  }

  console.log(
    `\nCompare against your plan's limit in the Supabase dashboard (Settings → Usage).\n` +
      `If the large tables are the ones holding PHOTOS or logs, retention is the fix —\n` +
      `see src/lib/archive.ts. If they are the ones holding figures, nothing is wrong.\n`
  );
} finally {
  await sql.end({ timeout: 5 });
}
