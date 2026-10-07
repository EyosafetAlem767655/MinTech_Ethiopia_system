/**
 * The quarterly move: records past their keep period go from Supabase to the
 * permanent archive database in Neon.
 *
 *   npx tsx scripts/archive-to-neon.ts --dry-run   # count, move nothing
 *   npx tsx scripts/archive-to-neon.ts             # move
 *
 * Run by .github/workflows/quarterly-archive.yml on the 1st of January, April,
 * July and October. What moves is decided by src/lib/lifecycle.ts — the same
 * rules the System Admin view counts with — and nothing in this file adds to or
 * subtracts from them.
 *
 * THE ORDER IS THE SAFETY PROPERTY. For each batch:
 *   1. read the rows (and every row that would cascade-delete with them);
 *   2. write them all to Neon;
 *   3. read them back from Neon and confirm every one is there;
 *   4. only then delete them from Supabase.
 * A crash between 2 and 4 leaves rows in BOTH places, which is harmless — the
 * next run writes them again (a no-op) and finishes the delete. Nothing in this
 * file can leave a row in neither.
 *
 * It refuses to start unless:
 *   - last night's backup succeeded (so Supabase as it was this morning exists
 *     in Neon and in a 30-day dump, whatever this run does), and
 *   - the archive database is NOT the one the nightly backup restores into:
 *     that restore runs with --clean and would wipe an archive kept there.
 *
 * Rows are stored as JSON, one table for all of them:
 *   archived_rows(table_name, row_id, row_date, row jsonb, batch_id, archived_at)
 * so a migration that changes a table here can never make its archived rows
 * unwritable or unreadable. scripts/archive-restore.ts puts rows back.
 *
 * Env: SUPABASE_DB_URL (the session pooler), NEON_ARCHIVE_URL, TELEGRAM_BOT_TOKEN.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import sql from "../src/lib/sql";
import { cutoffFor, movableWhere, moveRules, quoteIdent, type MoveRule } from "../src/lib/lifecycle";
import { isOverdue, latestJobRuns, recordJob } from "../src/lib/system-jobs";
import { notifyAdmins } from "../src/lib/admins";

const DRY = process.argv.includes("--dry-run");
const BATCH = 500;

const archiveUrl = (process.env.NEON_ARCHIVE_URL || "").trim();
const neon = archiveUrl
  ? postgres(archiveUrl, { max: 2, idle_timeout: 20, connect_timeout: 20, prepare: false, onnotice: () => {} })
  : null;

interface CascadeChild {
  table: string;
  childColumn: string;
  parentColumn: string;
}

/** Rows that delete with a parent: ON DELETE CASCADE foreign keys, by parent table. */
async function cascadeMap(): Promise<Map<string, CascadeChild[]>> {
  const rows = await sql<{ child: string; parent: string; child_cols: string[]; parent_cols: string[] }[]>`
    select ch.relname as child, pa.relname as parent,
           array(select a.attname::text from unnest(c.conkey) k join pg_attribute a
                   on a.attrelid = c.conrelid and a.attnum = k) as child_cols,
           array(select a.attname::text from unnest(c.confkey) k join pg_attribute a
                   on a.attrelid = c.confrelid and a.attnum = k) as parent_cols
      from pg_constraint c
      join pg_class ch on ch.oid = c.conrelid
      join pg_class pa on pa.oid = c.confrelid
      join pg_namespace n on n.oid = ch.relnamespace
     where c.contype = 'f' and c.confdeltype = 'c' and n.nspname = 'public'
  `;
  const map = new Map<string, CascadeChild[]>();
  for (const r of rows) {
    if (r.child_cols.length !== 1) continue; // none exist here; a composite key would need its own handling
    const list = map.get(r.parent) ?? [];
    list.push({ table: r.child, childColumn: r.child_cols[0], parentColumn: r.parent_cols[0] });
    map.set(r.parent, list);
  }
  return map;
}

interface ArchivedRow {
  table_name: string;
  row_id: string;
  row_date: string | null;
  row: Record<string, unknown>;
}

/** Everything that cascades from these parent rows, recursively, as archive rows. */
async function cascadeRows(
  table: string,
  parents: Record<string, unknown>[],
  rowDate: string | null,
  cascades: Map<string, CascadeChild[]>,
  depth = 0
): Promise<ArchivedRow[]> {
  if (depth > 5 || parents.length === 0) return [];
  const out: ArchivedRow[] = [];
  for (const ch of cascades.get(table) ?? []) {
    const keys = parents.map((p) => p[ch.parentColumn]).filter((v) => v !== null && v !== undefined).map(String);
    if (keys.length === 0) continue;
    const rows = await sql.unsafe<{ row: Record<string, unknown> }[]>(
      `select to_jsonb(c) as row from ${quoteIdent(ch.table)} c where c.${quoteIdent(ch.childColumn)}::text = any($1::text[])`,
      [keys]
    );
    const childRows = rows.map((r) => r.row);
    for (const row of childRows) {
      out.push({
        table_name: ch.table,
        row_id: String(row.id ?? JSON.stringify(row)),
        row_date: rowDate,
        row,
      });
    }
    out.push(...(await cascadeRows(ch.table, childRows, rowDate, cascades, depth + 1)));
  }
  return out;
}

async function ensureArchiveSchema() {
  await neon!`
    create table if not exists archived_rows (
      table_name  text not null,
      row_id      text not null,
      row_date    timestamptz,
      row         jsonb not null,
      batch_id    uuid not null,
      archived_at timestamptz not null default now(),
      primary key (table_name, row_id)
    )
  `;
  await neon!`create index if not exists archived_rows_date_idx on archived_rows (table_name, row_date)`;
  await neon!`
    create table if not exists archive_batches (
      id          uuid primary key,
      started_at  timestamptz not null default now(),
      finished_at timestamptz,
      ok          boolean,
      detail      jsonb
    )
  `;
}

/** Write rows to Neon, then prove every one of them is there. */
async function copyAndVerify(rows: ArchivedRow[], batchId: string): Promise<void> {
  if (rows.length === 0) return;
  // Sent as TEXT and cast in SQL. Handed straight to a ::jsonb parameter, the
  // string is encoded a second time and arrives as one JSON string instead of
  // an array — which the test run against two scratch databases caught.
  const payload = rows.map((r) => ({ ...r, batch_id: batchId }));
  await neon!.unsafe(
    `insert into archived_rows (table_name, row_id, row_date, row, batch_id)
     select x.table_name, x.row_id, x.row_date, x.row, x.batch_id
       from jsonb_to_recordset($1::text::jsonb)
         as x(table_name text, row_id text, row_date timestamptz, row jsonb, batch_id uuid)
     on conflict (table_name, row_id) do nothing`,
    [JSON.stringify(payload)]
  );
  // Verified per table against the ids we meant to write — not against the
  // insert's own row count, which on a re-run is legitimately zero.
  const byTable = new Map<string, string[]>();
  for (const r of rows) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r.row_id]);
  for (const [table, ids] of byTable) {
    const unique = [...new Set(ids)];
    const [{ n }] = await neon!<{ n: string }[]>`
      select count(*) as n from archived_rows where table_name = ${table} and row_id = any(${unique})
    `;
    if (Number(n) !== unique.length) {
      throw new Error(`Neon holds ${n} of ${unique.length} ${table} rows just written — nothing deleted`);
    }
  }
}

async function moveTable(
  rule: MoveRule,
  now: Date,
  batchId: string,
  cascades: Map<string, CascadeChild[]>
): Promise<{ moved: number; children: number }> {
  const cutoff = cutoffFor(now, rule.keepMonths);
  let moved = 0;
  let children = 0;
  for (;;) {
    const rows = await sql.unsafe<{ row: Record<string, unknown>; row_date: string | null }[]>(
      `select to_jsonb(t) as row, (${rule.dateExpr})::timestamptz as row_date
         from ${quoteIdent(rule.table)} t
        where ${movableWhere(rule)}
        order by ${rule.dateExpr}
        limit ${BATCH}`,
      [cutoff]
    );
    if (rows.length === 0) break;

    const ids = rows.map((r) => String(r.row.id));
    const parentRows: ArchivedRow[] = rows.map((r) => ({
      table_name: rule.table,
      row_id: String(r.row.id),
      row_date: r.row_date,
      row: r.row,
    }));
    const childRows: ArchivedRow[] = [];
    for (const r of rows) {
      childRows.push(...(await cascadeRows(rule.table, [r.row], r.row_date, cascades)));
    }

    await copyAndVerify([...parentRows, ...childRows], batchId);

    // Only now. The cascade removes the children that were just archived.
    const deleted = await sql.begin((tx) =>
      tx.unsafe(`delete from ${quoteIdent(rule.table)} where id::text = any($1::text[]) returning id`, [ids])
    );
    if (deleted.length === 0) {
      throw new Error(`${rule.table}: ${ids.length} rows archived but none deleted — stopping so the batch is not re-read forever`);
    }
    moved += deleted.length;
    children += childRows.length;
    if (rows.length < BATCH) break;
  }
  return { moved, children };
}

async function main() {
  const now = new Date();
  const startedAt = now;
  const rules = moveRules();

  if (!neon) throw new Error("NEON_ARCHIVE_URL is not set — see docs/RUNBOOK-failover.md");

  // The archive must not live where the nightly restore runs `--clean`.
  const [{ has_live }] = await neon<{ has_live: boolean }[]>`
    select to_regclass('public.sales_invoices') is not null as has_live
  `;
  if (has_live) {
    throw new Error(
      "NEON_ARCHIVE_URL points at a database holding a copy of the live tables — that is the nightly backup's " +
        "database, whose restore would wipe the archive. Create a separate Neon database (e.g. mintech_archive)."
    );
  }

  if (!DRY) {
    const backup = (await latestJobRuns()).get("backup");
    if (!backup || backup.ok !== true || isOverdue("backup", backup, now)) {
      throw new Error(
        "Last night's backup is missing or failed. Nothing is moved without a fresh full copy — " +
          "re-run the backup workflow, then this one."
      );
    }
  }

  await ensureArchiveSchema();
  const cascades = await cascadeMap();
  const batchId = randomUUID();
  if (!DRY) await neon`insert into archive_batches (id) values (${batchId})`;

  const moved: Record<string, number> = {};
  const problems: string[] = [];
  let childTotal = 0;

  for (const rule of rules) {
    const cutoff = cutoffFor(now, rule.keepMonths);
    try {
      // Missing tables (a migration behind) and tables without an id are skipped, not fatal.
      const [{ has_id }] = await sql<{ has_id: boolean }[]>`
        select exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = ${rule.table} and column_name = 'id') as has_id
      `;
      if (!has_id) continue;

      if (DRY) {
        const [{ n }] = await sql.unsafe<{ n: string }[]>(
          `select count(*) as n from ${quoteIdent(rule.table)} t where ${movableWhere(rule)}`,
          [cutoff]
        );
        if (Number(n) > 0) moved[rule.table] = Number(n);
        continue;
      }

      const res = await moveTable(rule, now, batchId, cascades);
      if (res.moved > 0) moved[rule.table] = res.moved;
      childTotal += res.children;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01") continue;
      // One table failing does not stop the others. Its rows are in both places
      // at worst, never in neither, and the next run picks them up.
      problems.push(`${rule.table}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const [{ size }] = await neon<{ size: string }[]>`select pg_database_size(current_database()) as size`;
  const total = Object.values(moved).reduce((a, b) => a + b, 0);
  const detail = {
    dryRun: DRY,
    moved,
    childRows: childTotal,
    archiveBytes: Number(size) || 0,
    cutoffs: { records: cutoffFor(now, 12).toISOString().slice(0, 10), logs: cutoffFor(now, 3).toISOString().slice(0, 10) },
    problems,
    batchId,
  };
  if (!DRY) {
    await neon`update archive_batches set finished_at = now(), ok = ${problems.length === 0}, detail = ${neon.json(detail as never)} where id = ${batchId}`;
  }

  const summary = DRY
    ? `dry run: ${total} rows would move`
    : `${total} rows moved to the Neon archive (+${childTotal} attached rows)` + (problems.length ? `; ${problems.length} table(s) failed` : "");

  console.log(summary);
  for (const [t, n] of Object.entries(moved)) console.log(`  ${t.padEnd(28)} ${n}`);
  for (const p of problems) console.log(`  ✗ ${p}`);

  if (!DRY) {
    await recordJob({ job: "archive", startedAt, ok: problems.length === 0, summary, detail, source: "github" });
    if (problems.length === 0) {
      const lines = Object.entries(moved).map(([t, n]) => `• ${t} ${n}`).join("\n");
      await notifyAdmins(
        `📦 <b>Archive move done</b>\n${total} records moved from Supabase to the Neon archive` +
          (lines ? `:\n${lines}` : " — nothing was old enough.") +
          `\n\n<i>They are kept permanently in Neon and can be restored with scripts/archive-restore.ts.</i>`
      );
    }
  }
  if (problems.length) process.exitCode = 1;
}

main()
  .catch(async (e) => {
    const message = e instanceof Error ? e.message : String(e);
    console.error("archive-to-neon:", message);
    process.exitCode = 1;
    if (!DRY) await recordJob({ job: "archive", startedAt: new Date(), ok: false, summary: `refused or failed: ${message}`, source: "github" });
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => {});
    await neon?.end({ timeout: 5 }).catch(() => {});
  });
