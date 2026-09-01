import sql, { first, jsonb } from "@/lib/sql";
import { deleteFile } from "@/lib/storage";
import {
  childTablesOf,
  SUBMISSIONS,
  type SubmissionCollection,
  type SubmissionSpec,
} from "@/lib/submissions";

/**
 * The two-stage delete behind Settings → Submissions.
 *
 * Deleting a report moves it, whole, into `deleted_submissions`; the bin then
 * offers restore or permanent removal. The row leaves its own table at stage
 * one, so every report, total and metric stops counting it immediately — a
 * deleted submission that still shows up in a monthly figure would be worse than
 * no delete at all.
 *
 * Photos are the exception to "leaves immediately": the image files stay in the
 * bucket while the report sits in the bin, because a restore that came back
 * without its evidence would not be a restore. `purgeOldPhotos` is told to skip
 * anything the bin still references.
 */

export interface BinEntry {
  id: string;
  collection: string;
  sourceTable: string;
  rowId: string;
  summary: string | null;
  photoIds: string[];
  deletedBy: string;
  deletedAt: string;
  payload: Record<string, unknown>;
}

/** Columns a table actually has right now — schemas drift, jsonb does not. */
async function columnsOf(table: string): Promise<Set<string>> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = ${table}
  `;
  return new Set(rows.map((r) => r.column_name));
}

/** Every stored_files id the row points at, from all three storage layouts. */
function photoIdsFrom(spec: SubmissionSpec, row: Record<string, unknown>, childRows: Record<string, Record<string, unknown>[]>): string[] {
  const out: string[] = [];
  if (spec.photosColumn && Array.isArray(row[spec.photosColumn])) {
    out.push(...(row[spec.photosColumn] as unknown[]).map(String));
  }
  if (spec.photoColumn && row[spec.photoColumn]) out.push(String(row[spec.photoColumn]));
  const join = spec.photoJoin;
  if (join) {
    for (const child of childRows[join.table] || []) {
      const v = child[join.fileColumn];
      if (v) out.push(String(v));
    }
  }
  return Array.from(new Set(out.filter((v) => v && v !== "null")));
}

/** A one-line description, so the bin list reads without unpacking the payload. */
function summarise(spec: SubmissionSpec, row: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const f of spec.displayFields.slice(0, 3)) {
    const v = row[f.column];
    if (v == null || v === "") continue;
    parts.push(`${f.label}: ${String(v).slice(0, 40)}`);
  }
  if (spec.authorColumn && row[spec.authorColumn]) parts.push(String(row[spec.authorColumn]));
  return parts.join(" · ").slice(0, 300) || spec.label;
}

/**
 * Stage one: move a submission into the bin.
 *
 * The order matters. Children are read BEFORE the parent is deleted, because
 * `on delete cascade` takes them with it and there is nothing left to ask
 * afterwards. The bin row is written before the delete for the same reason: if
 * the insert fails, the report is still in its own table.
 */
export async function binSubmission(opts: {
  collection: SubmissionCollection;
  id: string;
  deletedBy: string;
}): Promise<{ ok: true; photoIds: string[] } | { ok: false; reason: "not_found" }> {
  const spec = SUBMISSIONS[opts.collection];

  const row = first(
    await sql<Record<string, unknown>[]>`select * from ${sql(spec.table)} where id = ${opts.id}`
  );
  if (!row) return { ok: false, reason: "not_found" };

  const childRows: Record<string, Record<string, unknown>[]> = {};
  for (const child of childTablesOf(spec)) {
    childRows[child.table] = await sql<Record<string, unknown>[]>`
      select * from ${sql(child.table)} where ${sql(child.foreignKey)} = ${opts.id}
    `.catch(() => []);
  }

  const photoIds = photoIdsFrom(spec, row, childRows);

  await sql`
    insert into deleted_submissions
      (collection, source_table, row_id, payload, children, photo_ids, summary, deleted_by)
    values (${opts.collection}, ${spec.table}, ${opts.id}, ${jsonb(row)}, ${jsonb(childRows)},
            ${photoIds}, ${summarise(spec, row)}, ${opts.deletedBy})
    on conflict (source_table, row_id) do update set
      payload = excluded.payload,
      children = excluded.children,
      photo_ids = excluded.photo_ids,
      summary = excluded.summary,
      deleted_by = excluded.deleted_by,
      deleted_at = now()
  `;

  await sql`delete from ${sql(spec.table)} where id = ${opts.id}`;
  return { ok: true, photoIds };
}

/**
 * Stage two, first option: put it back.
 *
 * Columns are filtered against the table as it exists NOW. A field dropped since
 * the deletion is left behind and one added since comes back null, so a restore
 * cannot be blocked by a migration that landed in between.
 */
export async function restoreSubmission(
  binId: string
): Promise<{ ok: true; collection: string; rowId: string } | { ok: false; reason: "not_found" | "exists" }> {
  const entry = first(
    await sql<
      {
        collection: string;
        source_table: string;
        row_id: string;
        payload: Record<string, unknown>;
        children: Record<string, Record<string, unknown>[]>;
      }[]
    >`select collection, source_table, row_id, payload, children from deleted_submissions where id = ${binId}`
  );
  if (!entry) return { ok: false, reason: "not_found" };

  const already = first(
    await sql<{ id: string }[]>`select id from ${sql(entry.source_table)} where id = ${entry.row_id}`
  );
  // Something already occupies that id — refuse rather than overwrite a live report.
  if (already) return { ok: false, reason: "exists" };

  const present = await columnsOf(entry.source_table);
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry.payload || {})) {
    if (present.has(k)) payload[k] = v;
  }
  if (Object.keys(payload).length === 0) return { ok: false, reason: "not_found" };

  await sql`insert into ${sql(entry.source_table)} ${sql(payload, ...Object.keys(payload))}`;

  // Children come back under the same parent id. Best-effort per table: a child
  // table dropped since the deletion must not strand the parent in the bin.
  for (const [table, rows] of Object.entries(entry.children || {})) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const childCols = await columnsOf(table).catch(() => new Set<string>());
    if (childCols.size === 0) continue;
    for (const childRow of rows) {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(childRow || {})) if (childCols.has(k)) clean[k] = v;
      if (Object.keys(clean).length === 0) continue;
      await sql`insert into ${sql(table)} ${sql(clean, ...Object.keys(clean))}`.catch((e) =>
        console.error(`restoreSubmission: child ${table} failed`, e)
      );
    }
  }

  await sql`delete from deleted_submissions where id = ${binId}`;
  return { ok: true, collection: entry.collection, rowId: entry.row_id };
}

/**
 * Stage two, second option: gone for good, photos included.
 *
 * The images are only released here. Until this point the report is restorable,
 * and a restore without its evidence is not one.
 */
export async function purgeBinEntry(
  binId: string
): Promise<{ ok: true; photosRemoved: number } | { ok: false; reason: "not_found" }> {
  const entry = first(
    await sql<{ photo_ids: string[] }[]>`select photo_ids from deleted_submissions where id = ${binId}`
  );
  if (!entry) return { ok: false, reason: "not_found" };

  await sql`delete from deleted_submissions where id = ${binId}`;

  const results = await Promise.allSettled((entry.photo_ids || []).map((id) => deleteFile(id)));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) console.error(`purgeBinEntry: ${failed} photo(s) could not be removed`);
  return { ok: true, photosRemoved: (entry.photo_ids || []).length - failed };
}

/** The bin, newest first. */
export async function listBin(limit = 100, collection?: string): Promise<BinEntry[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select id, collection, source_table, row_id, summary, photo_ids, deleted_by, deleted_at, payload
      from deleted_submissions
     where ${collection ? sql`collection = ${collection}` : sql`true`}
     order by deleted_at desc
     limit ${Math.min(limit, 300)}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    collection: String(r.collection),
    sourceTable: String(r.source_table),
    rowId: String(r.row_id),
    summary: (r.summary as string) ?? null,
    photoIds: ((r.photo_ids as string[]) || []).map(String),
    deletedBy: String(r.deleted_by),
    deletedAt: String(r.deleted_at),
    payload: (r.payload as Record<string, unknown>) || {},
  }));
}
