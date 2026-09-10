import sql from "@/lib/sql";
import { logError } from "@/lib/errors";

/**
 * Inserting a row that survives a database one migration behind.
 *
 * This exists because of a specific, repeated failure. A report is filed from
 * the bot, the reporter checks it, approves it — and the insert dies on
 * `column "tg_file_id" of relation "purchase_requests" does not exist`, because
 * the code shipped ahead of the migration. The reporter sees "something went
 * wrong", the data they were holding is gone, and the same thing happens on
 * every retry. Deploys and migrations are two separate acts here — the SQL is
 * applied by hand in the Supabase editor — so that window is not an edge case,
 * it is every deploy.
 *
 * The rule this encodes: **a missing OPTIONAL column costs that column, never
 * the submission.** The names passed as `optional` are all supporting evidence —
 * a Telegram file id pointing at a photograph. The report is the record; a
 * pointer to a picture of it is not worth the report.
 *
 * What it deliberately does NOT do is tolerate an unknown column. Only names
 * listed in `optional` are ever dropped, so a genuine typo or a renamed column
 * still fails loudly rather than quietly writing a row with a field missing.
 */

/**
 * Quote an identifier for interpolation into SQL text.
 *
 * Table and column names here are literals written in this repository, never
 * user input — but they are still quoted, because an unquoted identifier that
 * happens to collide with a keyword is a bug that only shows up on the one table
 * unlucky enough to be named badly.
 */
function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * The statement and its positional values.
 *
 * Built by hand rather than with postgres.js's `sql(object)` helper, which
 * cannot be used here: that helper picks its behaviour by searching the SQL
 * text BEFORE it for a keyword, so in `insert into ${sql(table)}` the table name
 * is matched by the word "insert" and expanded as a column list —
 * `Object.keys("purchase_requests")` — rather than as an identifier. It only
 * works with a literal table name, and this helper's whole point is that the
 * table varies.
 *
 * Exported for tests: the composed text is the thing worth asserting on, and
 * without a database there is nothing else to check it against.
 */
export function buildInsert(
  table: string,
  row: Record<string, unknown>
): { text: string; values: unknown[] } {
  const columns = Object.keys(row);
  if (columns.length === 0) throw new Error(`buildInsert(${table}): no columns`);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  return {
    text: `insert into ${ident(table)} (${columns.map(ident).join(", ")}) values (${placeholders}) returning id`,
    values: columns.map((c) => row[c]),
  };
}

/** The column named in a 42703, e.g. `column "tg_file_id" of relation …`. */
function missingColumn(e: unknown): string | null {
  const message = String((e as { message?: string })?.message || "");
  return message.match(/column "([^"]+)"/)?.[1] ?? null;
}

export interface InsertOptions {
  /**
   * Columns that may be dropped if the database has not got them yet.
   * Everything else is required, and its absence is a real error.
   */
  optional?: string[];
  /** For the error log, so a drift shows up attributed to a flow. */
  source?: string;
}

/**
 * Insert one row, dropping optional columns the database has not got yet.
 *
 * Returns the inserted row's id. Throws for every failure that is not a missing
 * optional column — a dead database, a constraint violation and a bad value all
 * still reach the caller, because those are not things to paper over.
 */
export async function insertRow(
  table: string,
  row: Record<string, unknown>,
  opts: InsertOptions = {}
): Promise<{ id: string }> {
  const optional = new Set(opts.optional || []);
  const payload = { ...row };
  const dropped: string[] = [];

  // Bounded by the number of optional columns: each pass removes exactly one, so
  // the worst case is one attempt per optional column plus the successful one.
  for (let attempt = 0; attempt <= optional.size; attempt++) {
    const { text, values } = buildInsert(table, payload);
    try {
      const [out] = await sql.unsafe<{ id: string }[]>(text, values as never[]);
      if (dropped.length) {
        // Loud, because the row just written is INCOMPLETE and the deployment is
        // running ahead of its schema. Silence here would let the drift persist
        // for months, quietly costing every photo reference filed in that time.
        void logError({
          source: opts.source || "insert",
          kind: "schema_column_missing",
          message: `${table}: row written WITHOUT ${dropped.join(", ")} — the migration adding it has not been applied.`,
          detail: { table, dropped },
        });
      }
      return out;
    } catch (e) {
      if ((e as { code?: string })?.code !== "42703") throw e;
      const column = missingColumn(e);
      // Not one of ours to drop: a required column, or a name we never sent.
      // Either way the caller has to see it.
      if (!column || !optional.has(column) || !(column in payload)) throw e;
      delete payload[column];
      dropped.push(column);
    }
  }

  // Unreachable: the loop runs once more than there are droppable columns, so
  // the final pass either succeeds or throws something that is not a 42703.
  throw new Error(`insertRow(${table}): exhausted optional columns`);
}
