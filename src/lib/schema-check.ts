import sql from "@/lib/sql";

/**
 * Does the database have the columns this deployment writes to?
 *
 * Migrations here are applied BY HAND in the Supabase editor, so a deploy and
 * its schema are two separate acts and the gap between them is not an edge case.
 * `insertRow` already stops that gap from losing a submission — it drops an
 * allow-listed column and logs `schema_column_missing` — but that log row says
 * which column, not which file to run, and nobody correlated the two. A tool
 * request photo was being dropped for days before anyone noticed.
 *
 * So the expectation is written down, checked in one query, and shown in
 * Settings → Errors with the migration that fixes it.
 *
 * Only the columns that CAN go missing are listed: the ones added by a later
 * migration and tolerated at the insert. A column from 0001 has been there since
 * the first day the app ran at all, and listing it would only add noise.
 */

export interface ExpectedColumn {
  table: string;
  column: string;
  /** The migration file that adds it — what the owner actually needs to run. */
  migration: string;
}

export const EXPECTED_COLUMNS: ExpectedColumn[] = [
  // Telegram file ids, replacing uploads (0023 / 0025).
  { table: "purchase_requests", column: "tg_file_id", migration: "0025_no_uploads_but_pp_bags.sql" },
  { table: "daily_reports", column: "tg_file_ids", migration: "0025_no_uploads_but_pp_bags.sql" },
  { table: "material_counts", column: "tg_file_ids", migration: "0025_no_uploads_but_pp_bags.sql" },
  { table: "hr_reports", column: "tg_file_ids", migration: "0025_no_uploads_but_pp_bags.sql" },
  { table: "goods_receiving_vouchers", column: "tg_file_ids", migration: "0023_direct_receipt_reads.sql" },
  { table: "store_issue_vouchers", column: "tg_file_ids", migration: "0023_direct_receipt_reads.sql" },

  // The guided purchase request (0028).
  { table: "purchase_requests", column: "description", migration: "0028_purchase_request_details.sql" },
  { table: "purchase_requests", column: "unit", migration: "0028_purchase_request_details.sql" },
  { table: "purchase_requests", column: "department", migration: "0028_purchase_request_details.sql" },
  { table: "purchase_requests", column: "notes", migration: "0028_purchase_request_details.sql" },

  // Whiteness alarms (0032). Without it every re-save of a below-spec check
  // alerts every admin and HR user again, so its absence is loud rather than
  // quiet — worth naming here alongside the silent ones.
  { table: "whiteness_checks", column: "alerted_at", migration: "0032_whiteness_alerts.sql" },
];

/** Tables the app cannot work without, and the migration that creates each. */
export const EXPECTED_TABLES: { table: string; migration: string }[] = [
  { table: "sales_invoices", migration: "0027_sales_invoices.sql" },
  { table: "sales_credit_payments", migration: "0029_sales_credit.sql" },
  { table: "purchase_requests", migration: "0001_init.sql" },
  { table: "whiteness_checks", migration: "0022_bag_usage_whiteness.sql" },
  { table: "system_errors", migration: "0021_errors_and_scan_jobs.sql" },
];

/** The file to run to fix everything at once, whatever is missing. */
export const BACKFILL_MIGRATION = "0030_backfill_columns.sql";

export interface SchemaReport {
  ok: boolean;
  missing: ExpectedColumn[];
  missingTables: { table: string; migration: string }[];
  /** Set when the check itself could not run — never confused with "all fine". */
  error?: string;
}

/**
 * What the database is missing, in one round trip.
 *
 * A table that is absent is reported as a TABLE, not as four missing columns:
 * the two need different answers, and a list of columns belonging to something
 * that does not exist reads as far worse drift than it is.
 */
export async function checkSchema(): Promise<SchemaReport> {
  const tables = [...new Set([...EXPECTED_COLUMNS.map((c) => c.table), ...EXPECTED_TABLES.map((t) => t.table)])];

  try {
    const rows = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public' and table_name = any(${tables})
    `;

    const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    const tablesPresent = new Set(rows.map((r) => r.table_name));

    const missingTables = EXPECTED_TABLES.filter((t) => !tablesPresent.has(t.table));
    const missing = EXPECTED_COLUMNS.filter(
      // A column of a missing table is not reported twice.
      (c) => tablesPresent.has(c.table) && !present.has(`${c.table}.${c.column}`)
    );

    return { ok: missing.length === 0 && missingTables.length === 0, missing, missingTables };
  } catch (e) {
    // The check is a diagnostic. It must never be the thing that breaks the
    // screen it is diagnosing.
    return {
      ok: false,
      missing: [],
      missingTables: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
