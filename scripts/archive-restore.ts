/**
 * Put archived rows back into Supabase.
 *
 *   npx tsx scripts/archive-restore.ts --table sales_invoices [--from 2025-01-01] [--to 2025-12-31] [--dry-run]
 *
 * The other half of scripts/archive-to-neon.ts. Rows come back exactly as they
 * left — every column, the same id — through jsonb_populate_recordset, so the
 * dashboard reads them like any other row. A row already present here is left
 * alone, so running a restore twice is harmless.
 *
 * Restore a parent before its children: an invoice before its payments, a
 * voucher before its lines, a lot before its events. The children were archived
 * under their own table names, with the parent's date, so the same --from/--to
 * finds them.
 *
 * The archive keeps its copy. Restoring is copying back, not moving back — so
 * the next quarterly run will move the rows out again if they are still past
 * their keep period. To keep them here for good, restore them and change the
 * rule in src/lib/lifecycle.ts.
 *
 * Env: SUPABASE_DB_URL (the session pooler) and NEON_ARCHIVE_URL.
 */
import postgres from "postgres";
import sql from "../src/lib/sql";
import { quoteIdent } from "../src/lib/lifecycle";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const table = arg("table");
  const from = arg("from");
  const to = arg("to");
  const dry = process.argv.includes("--dry-run");
  if (!table || !/^[a-z_][a-z0-9_]*$/.test(table)) {
    console.error("Usage: archive-restore.ts --table <name> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]");
    process.exit(2);
  }
  const url = (process.env.NEON_ARCHIVE_URL || "").trim();
  if (!url) throw new Error("NEON_ARCHIVE_URL is not set");
  const neon = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    const rows = await neon<{ row: Record<string, unknown> }[]>`
      select row from archived_rows
       where table_name = ${table}
         and (${from ?? null}::date is null or row_date >= ${from ?? null}::date)
         and (${to ?? null}::date is null or row_date < (${to ?? null}::date + 1))
       order by row_date
    `;
    console.log(`${rows.length} archived ${table} row(s) match.`);
    if (dry || rows.length === 0) return;

    let restored = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => r.row);
      const res = await sql.unsafe(
        `insert into ${quoteIdent(table)}
         select * from jsonb_populate_recordset(null::${quoteIdent(table)}, $1::text::jsonb)
         on conflict do nothing
         returning 1`,
        [JSON.stringify(chunk)]
      );
      restored += res.length;
    }
    console.log(`${restored} restored; ${rows.length - restored} were already here.`);
  } finally {
    await neon.end({ timeout: 5 }).catch(() => {});
  }
}

main()
  .catch((e) => {
    console.error("archive-restore:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }).catch(() => {}));
