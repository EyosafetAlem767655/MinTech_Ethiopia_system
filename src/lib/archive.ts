import ExcelJS from "exceljs";
import sql from "@/lib/sql";
import { SUBMISSIONS, SUBMISSION_COLLECTIONS } from "@/lib/submissions";

/**
 * Yearly data archive.
 *
 * Records older than the retention window are exported to a single workbook
 * (one sheet per table), Telegrammed to the administrators, and only then
 * deleted. The export is therefore the ONLY surviving copy — so the caller must
 * confirm delivery before purging. See src/app/api/cron/archive-and-purge.
 */

export const RETENTION_DAYS = 365;

/**
 * Tables the purge covers, in an order safe for foreign keys: children before
 * parents. Rows are selected by `dateColumn`.
 *
 * Deliberately excluded, because they are identity/configuration rather than
 * records — purging them would lock every employee out of the bot and drop the
 * browsers registered for push:
 *   • telegram_users
 *   • push_subscriptions
 */
export interface ArchiveTable {
  table: string;
  dateColumn: string;
  /** Sheet name in the workbook (Excel caps these at 31 chars). */
  sheet: string;
  /**
   * Child rows have no date of their own; they are archived and deleted via
   * their parent. `on delete cascade` already removes them, but we still export
   * them so the archive is complete.
   */
  parent?: { table: string; fk: string; dateColumn: string };
}

/**
 * Child tables, exported before their parent and removed by its cascade.
 *
 * They have no date of their own, so they are resolved through the parent's.
 */
const CHILD_TABLES: ArchiveTable[] = [
  { table: "claim_photos", dateColumn: "created_at", sheet: "claim_photos",
    parent: { table: "damage_claims", fk: "claim_id", dateColumn: "created_at" } },
  { table: "pp_bag_damage_photos", dateColumn: "created_at", sheet: "pp_bag_damage_photos",
    parent: { table: "pp_bag_damage_reports", fk: "report_id", dateColumn: "date" } },
  { table: "finance_purchase_items", dateColumn: "created_at", sheet: "finance_purchase_items",
    parent: { table: "finance_purchase_batches", fk: "batch_id", dateColumn: "date" } },
  { table: "wht_sms_log", dateColumn: "created_at", sheet: "wht_sms_log",
    parent: { table: "wht_holders", fk: "holder_id", dateColumn: "created_at" } },
  // The voucher line items ARE the voucher. Without these two the yearly archive
  // would ship headers with no contents, and the cascade would still delete the
  // lines — the exact shape of loss this list exists to prevent.
  { table: "goods_receiving_items", dateColumn: "created_at", sheet: "goods_receiving_items",
    parent: { table: "goods_receiving_vouchers", fk: "grv_id", dateColumn: "date" } },
  { table: "store_issue_items", dateColumn: "created_at", sheet: "store_issue_items",
    parent: { table: "store_issue_vouchers", fk: "siv_id", dateColumn: "date" } },
  { table: "bag_events", dateColumn: "date", sheet: "bag_events",
    parent: { table: "bag_lots", fk: "lot_id", dateColumn: "received_at" } },
];

/**
 * Operational tables that are not submissions.
 *
 * Deliberately excluded, because they are identity or configuration rather than
 * records — wiping them would lock every employee out of the bot and drop the
 * browsers registered for push:
 *   • telegram_users
 *   • push_subscriptions
 *   • web_sessions
 */
const EXTRA_TABLES: ArchiveTable[] = [
  { table: "bag_lots", dateColumn: "received_at", sheet: "bag_lots" },
  { table: "briefs", dateColumn: "created_at", sheet: "briefs" },
  { table: "bot_activity", dateColumn: "created_at", sheet: "bot_activity" },
  { table: "telegram_sessions", dateColumn: "updated_at", sheet: "telegram_sessions" },
  { table: "telegram_updates", dateColumn: "created_at", sheet: "telegram_updates" },
  { table: "ai_chat_usage", dateColumn: "updated_at", sheet: "ai_chat_usage" },
  { table: "stored_files", dateColumn: "created_at", sheet: "stored_files" },
  // The recycle bin is data too: emptied by the reset like everything else, and
  // exported first so a deleted-but-not-yet-purged report is still in the file.
  { table: "deleted_submissions", dateColumn: "deleted_at", sheet: "deleted_submissions" },
];

/**
 * Every table the archive covers.
 *
 * The submission tables are DERIVED from the registry rather than listed again.
 * This list had silently gone stale once already: it still named invoices and
 * payments months after that module was deleted, and knew nothing about
 * production reports, deliveries, sales receipts, PP bag reports or any of the
 * finance tables — so the yearly export would have shipped a workbook missing
 * most of the company's data, and the purge would have left those tables
 * untouched. Deriving it means adding a report type cannot forget the archive.
 */
export const ARCHIVE_TABLES: ArchiveTable[] = (() => {
  const seen = new Set(CHILD_TABLES.map((t) => t.table));
  const submissionTables: ArchiveTable[] = [];
  for (const key of SUBMISSION_COLLECTIONS) {
    const spec = SUBMISSIONS[key];
    if (seen.has(spec.table)) continue;
    seen.add(spec.table);
    submissionTables.push({
      table: spec.table,
      // A text "YYYY-MM-DD" column cannot be compared against a timestamp, and
      // created_at exists on every one of these tables.
      dateColumn: spec.dateIsText ? "created_at" : spec.dateColumn,
      sheet: spec.table.slice(0, 31),
    });
  }
  const extras = EXTRA_TABLES.filter((t) => !seen.has(t.table));
  // Children first: they are exported before the cascade takes them.
  return [...CHILD_TABLES, ...submissionTables, ...extras];
})();

export function cutoffDate(now = new Date(), days = RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 86400000);
}

/**
 * Rows to archive, resolving child tables through their parent's date.
 *
 * A null cutoff means EVERYTHING — the yearly reset, which starts the new year
 * empty rather than trimming a rolling window off the back.
 *
 * A table this database does not have is not an error. The list spans several
 * years of schema, and a deployment that never ran an old migration (or has
 * already dropped a retired module) must still produce a complete archive of
 * what it does hold.
 */
async function selectExpiring(t: ArchiveTable, cutoff: Date | null): Promise<Record<string, unknown>[]> {
  const query = async () => {
    if (t.parent) {
      return cutoff
        ? await sql<Record<string, unknown>[]>`
            select c.* from ${sql(t.table)} c
             where c.${sql(t.parent.fk)} in (
               select p.id from ${sql(t.parent.table)} p where p.${sql(t.parent.dateColumn)} < ${cutoff}
             )`
        : await sql<Record<string, unknown>[]>`select * from ${sql(t.table)}`;
    }
    return cutoff
      ? await sql<Record<string, unknown>[]>`
          select * from ${sql(t.table)} where ${sql(t.dateColumn)} < ${cutoff}`
      : await sql<Record<string, unknown>[]>`select * from ${sql(t.table)}`;
  };

  try {
    return await query();
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01" || code === "42703") {
      console.warn(`archive: skipping ${t.table} (${code})`);
      return [];
    }
    throw e;
  }
}

/**
 * "retention" keeps the last year and archives what falls off the back.
 * "full" archives everything, for the yearly reset that starts September clean.
 */
export type ArchiveMode = "retention" | "full";

export interface ArchiveResult {
  mode: ArchiveMode;
  /** null in full mode — there is no cutoff, the whole table goes. */
  cutoff: Date | null;
  counts: Record<string, number>;
  totalRows: number;
  workbook: Buffer | null;
  filename: string;
}

/** Excel rejects some characters outright and cells cap at 32,767 chars. */
function cellValue(v: unknown): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 32000);
  const s = String(v);
  // Strip control characters that would make the workbook unreadable.
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, 32000);
}

/**
 * Builds the workbook of everything older than the cutoff.
 * Returns `workbook: null` when there is nothing to archive.
 */
export async function buildArchive(
  now = new Date(),
  mode: ArchiveMode = "retention"
): Promise<ArchiveResult> {
  const cutoff = mode === "full" ? null : cutoffDate(now);
  const counts: Record<string, number> = {};
  const datasets: { sheet: string; rows: Record<string, unknown>[] }[] = [];
  let totalRows = 0;

  for (const t of ARCHIVE_TABLES) {
    const rows = await selectExpiring(t, cutoff);
    counts[t.table] = rows.length;
    totalRows += rows.length;
    if (rows.length > 0) datasets.push({ sheet: t.sheet, rows });
  }

  const stamp = now.toISOString().slice(0, 10);
  const filename =
    mode === "full" ? `mintech-full-archive-${stamp}.xlsx` : `mintech-archive-${stamp}.xlsx`;

  if (totalRows === 0) return { mode, cutoff, counts, totalRows, workbook: null, filename };

  const wb = new ExcelJS.Workbook();
  wb.creator = "MinTech Ethiopia";
  wb.created = now;

  // Summary sheet first, so the recipient can see at a glance what this covers.
  const summary = wb.addWorksheet("summary");
  summary.addRow([
    mode === "full" ? "MinTech Ethiopia — full data archive (yearly reset)" : "MinTech Ethiopia — data archive",
  ]);
  summary.addRow([`Generated`, now.toISOString()]);
  summary.addRow([
    `Covers`,
    cutoff ? `records older than ${cutoff.toISOString()}` : "EVERY record in the database",
  ]);
  summary.addRow([`Retention window (days)`, cutoff ? RETENTION_DAYS : "n/a — full reset"]);
  summary.addRow([]);
  summary.addRow(["Table", "Rows archived"]);
  for (const t of ARCHIVE_TABLES) summary.addRow([t.table, counts[t.table] ?? 0]);
  summary.addRow([]);
  summary.addRow(["TOTAL", totalRows]);
  summary.getRow(1).font = { bold: true, size: 14 };
  summary.getRow(6).font = { bold: true };
  summary.getColumn(1).width = 26;
  summary.getColumn(2).width = 40;

  for (const { sheet, rows } of datasets) {
    const ws = wb.addWorksheet(sheet.slice(0, 31));
    const headers = Object.keys(rows[0]);
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    for (const row of rows) ws.addRow(headers.map((h) => cellValue(row[h])));
    ws.columns.forEach((c) => { c.width = 20; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  const workbook = Buffer.from(await wb.xlsx.writeBuffer());
  return { mode, cutoff, counts, totalRows, workbook, filename };
}

/**
 * Deletes everything older than the cutoff.
 *
 * ONLY call this once the archive has been confirmed delivered. Child tables
 * are removed by `on delete cascade`, so only the parents/standalone tables
 * need explicit deletes.
 */
export async function purgeOlderThan(cutoff: Date | null): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const t of ARCHIVE_TABLES) {
    if (t.parent) continue; // cascades with its parent
    try {
      // A null cutoff empties the table — the yearly reset. Written as an
      // unqualified DELETE rather than TRUNCATE so the cascades behave exactly
      // as they do on a single-row delete, and so a table that is missing from
      // this database fails the same harmless way as it does in the export.
      const rows = cutoff
        ? await sql`delete from ${sql(t.table)} where ${sql(t.dateColumn)} < ${cutoff} returning 1`
        : await sql`delete from ${sql(t.table)} returning 1`;
      deleted[t.table] = rows.length;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01" || code === "42703") {
        console.warn(`purge: skipping ${t.table} (${code})`);
        deleted[t.table] = 0;
        continue;
      }
      throw e;
    }
  }
  return deleted;
}

/** Administrators who can actually receive the archive on Telegram. */
export async function archiveRecipients(): Promise<{ id: string; fullName: string; chatId: string }[]> {
  const rows = await sql<{ id: string; full_name: string; chat_id: string }[]>`
    select id, full_name, chat_id
      from telegram_users
     where active = true and chat_id is not null and 'admin' = any(positions)
  `;
  return rows.map((r) => ({ id: r.id, fullName: r.full_name, chatId: r.chat_id }));
}
