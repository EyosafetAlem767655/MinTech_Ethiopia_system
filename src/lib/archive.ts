import ExcelJS from "exceljs";
import sql from "@/lib/sql";

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

export const ARCHIVE_TABLES: ArchiveTable[] = [
  // Children first (exported, then removed by cascade when the parent goes).
  { table: "claim_photos", dateColumn: "created_at", sheet: "claim_photos",
    parent: { table: "damage_claims", fk: "claim_id", dateColumn: "created_at" } },
  { table: "payments", dateColumn: "date", sheet: "payments",
    parent: { table: "invoices", fk: "invoice_id", dateColumn: "invoiced_at" } },
  { table: "invoice_reminders", dateColumn: "sent_at", sheet: "invoice_reminders",
    parent: { table: "invoices", fk: "invoice_id", dateColumn: "invoiced_at" } },
  { table: "bag_events", dateColumn: "date", sheet: "bag_events",
    parent: { table: "bag_lots", fk: "lot_id", dateColumn: "received_at" } },

  // Parents / standalone.
  { table: "damage_claims", dateColumn: "created_at", sheet: "damage_claims" },
  { table: "invoices", dateColumn: "invoiced_at", sheet: "invoices" },
  { table: "bag_lots", dateColumn: "received_at", sheet: "bag_lots" },
  { table: "receipts", dateColumn: "created_at", sheet: "receipts" },
  { table: "purchase_requests", dateColumn: "created_at", sheet: "purchase_requests" },
  { table: "stone_deliveries", dateColumn: "date", sheet: "stone_deliveries" },
  { table: "shift_reports", dateColumn: "date", sheet: "shift_reports" },
  { table: "daily_ops_reports", dateColumn: "date", sheet: "daily_ops_reports" },
  { table: "daily_reports", dateColumn: "created_at", sheet: "daily_reports" },
  { table: "hr_reports", dateColumn: "created_at", sheet: "hr_reports" },
  { table: "material_counts", dateColumn: "created_at", sheet: "material_counts" },
  { table: "briefs", dateColumn: "created_at", sheet: "briefs" },
  { table: "bot_activity", dateColumn: "created_at", sheet: "bot_activity" },
  { table: "telegram_sessions", dateColumn: "updated_at", sheet: "telegram_sessions" },
  { table: "stored_files", dateColumn: "created_at", sheet: "stored_files" },
];

export function cutoffDate(now = new Date(), days = RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 86400000);
}

/** Rows older than `cutoff`, resolving child tables through their parent's date. */
async function selectExpiring(t: ArchiveTable, cutoff: Date): Promise<Record<string, unknown>[]> {
  if (t.parent) {
    return sql<Record<string, unknown>[]>`
      select c.* from ${sql(t.table)} c
       where c.${sql(t.parent.fk)} in (
         select p.id from ${sql(t.parent.table)} p where p.${sql(t.parent.dateColumn)} < ${cutoff}
       )
    ` as unknown as Promise<Record<string, unknown>[]>;
  }
  return sql<Record<string, unknown>[]>`
    select * from ${sql(t.table)} where ${sql(t.dateColumn)} < ${cutoff}
  ` as unknown as Promise<Record<string, unknown>[]>;
}

export interface ArchiveResult {
  cutoff: Date;
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
export async function buildArchive(now = new Date()): Promise<ArchiveResult> {
  const cutoff = cutoffDate(now);
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
  const filename = `mintech-archive-${stamp}.xlsx`;

  if (totalRows === 0) return { cutoff, counts, totalRows, workbook: null, filename };

  const wb = new ExcelJS.Workbook();
  wb.creator = "MinTech Ethiopia";
  wb.created = now;

  // Summary sheet first, so the recipient can see at a glance what this covers.
  const summary = wb.addWorksheet("summary");
  summary.addRow(["MinTech Ethiopia — data archive"]);
  summary.addRow([`Generated`, now.toISOString()]);
  summary.addRow([`Covers records older than`, cutoff.toISOString()]);
  summary.addRow([`Retention window (days)`, RETENTION_DAYS]);
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
  return { cutoff, counts, totalRows, workbook, filename };
}

/**
 * Deletes everything older than the cutoff.
 *
 * ONLY call this once the archive has been confirmed delivered. Child tables
 * are removed by `on delete cascade`, so only the parents/standalone tables
 * need explicit deletes.
 */
export async function purgeOlderThan(cutoff: Date): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const t of ARCHIVE_TABLES) {
    if (t.parent) continue; // cascades with its parent
    const rows = await sql`
      delete from ${sql(t.table)} where ${sql(t.dateColumn)} < ${cutoff} returning 1
    `;
    deleted[t.table] = rows.length;
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
