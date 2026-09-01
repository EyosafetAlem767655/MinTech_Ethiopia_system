import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import {
  isSubmissionCollection,
  isSubmissionRange,
  rangeStart,
  SUBMISSIONS,
  SUBMISSION_COLLECTIONS,
  type SubmissionCollection,
  type SubmissionSpec,
} from "@/lib/submissions";

export const dynamic = "force-dynamic";

/**
 * GET — bot submissions, newest first.
 *
 * `collection=all` reads every registered type at once. That is the default the
 * screen opens on, and it is the whole point: the previous default was the
 * free-text daily report, which almost nobody files any more now that the roles
 * report through guided flows. A report filed ten minutes ago was sitting in a
 * table two dropdown selections away, and the screen said "no submissions
 * found" — which read as the bot being broken.
 *
 * Every table/column name comes from the registry after the collection has been
 * validated against a closed enum, so nothing user-supplied ever reaches an
 * identifier position; the values still go through postgres.js parameters, and
 * identifiers through `sql()` which quotes them.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const collection = p.get("collection") || "all";
  const isAll = collection === "all";
  if (!isAll && !isSubmissionCollection(collection)) {
    return NextResponse.json(
      { error: `Unknown collection. Expected "all" or one of: ${SUBMISSION_COLLECTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  const limit = Math.min(Number(p.get("limit")) || 60, 200);
  const from = p.get("from") || "";
  const to = p.get("to") || "";
  const q = (p.get("q") || "").trim();
  const rangeParam = p.get("range") || "";
  const range = isSubmissionRange(rangeParam) ? rangeParam : null;
  const since = range ? rangeStart(range) : null;

  const targets: SubmissionCollection[] = isAll
    ? [...SUBMISSION_COLLECTIONS]
    : [collection as SubmissionCollection];

  // Reading every type costs one query each. They are cheap and indexed, and the
  // per-collection limit keeps the merge small — an admin screen listing what
  // arrived today is worth more than the round trips it saves.
  const perCollection = isAll ? Math.max(10, Math.ceil(limit / 4)) : limit;

  const results: { collection: SubmissionCollection; rows: Record<string, unknown>[] }[] = [];
  const unavailable: string[] = [];

  for (const key of targets) {
    const spec = SUBMISSIONS[key];
    try {
      const rows = await queryCollection(spec, { limit: perCollection, from, to, since, q });
      if (rows === null) unavailable.push(key);
      else results.push({ collection: key, rows });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      // A table or column from a migration that has not been applied yet must
      // not 500 the whole screen — report it as empty and say why. In the "all"
      // view one unmigrated table must not hide the other twenty-three either.
      if (code === "42P01" || code === "42703") {
        console.warn(`submissions: ${spec.table} not ready (${code})`);
        unavailable.push(key);
        continue;
      }
      if (!isAll) throw e;
      console.error(`submissions: ${spec.table} failed`, e);
      unavailable.push(key);
    }
  }

  if (!isAll) {
    const only = results[0];
    return NextResponse.json({
      collection,
      rows: only?.rows ?? [],
      unavailable: unavailable.length > 0,
    });
  }

  // Merged newest-first across types, each row carrying the collection it came
  // from so the UI can label and act on it.
  const merged = results
    .flatMap(({ collection: key, rows }) =>
      rows.map((r) => ({ ...r, _collection: key, _sortAt: sortInstant(SUBMISSIONS[key], r) }))
    )
    .sort((a, b) => b._sortAt - a._sortAt)
    .slice(0, limit);

  return NextResponse.json({
    collection: "all",
    rows: merged,
    counts: Object.fromEntries(results.map(({ collection: key, rows }) => [key, rows.length])),
    unavailableCollections: unavailable,
    unavailable: false,
  });
}

/** Sort key for the merged view: the report's own date, else when it landed. */
function sortInstant(spec: SubmissionSpec, row: Record<string, unknown>): number {
  const raw = row[spec.dateColumn] ?? row.created_at;
  const t = new Date(String(raw ?? "")).getTime();
  return isNaN(t) ? 0 : t;
}

/** One collection's rows, or null when the table is not in this database. */
async function queryCollection(
  spec: SubmissionSpec,
  opts: { limit: number; from: string; to: string; since: Date | null; q: string }
): Promise<Record<string, unknown>[] | null> {
  // Which columns this database actually has.
  //
  // Deployments routinely run ahead of their migrations here, and a single
  // column added by an unapplied migration used to blank the entire screen with
  // a 42703. Asking first costs one cheap catalogue query and means a report is
  // still listable, editable and deletable while a migration is outstanding —
  // the newest field simply does not show yet.
  const present = new Set(
    (
      await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = ${spec.table}
      `
    ).map((r) => r.column_name)
  );
  if (present.size === 0) return null;

  const columns = Array.from(
    new Set(
      [
        "id",
        spec.dateColumn,
        spec.authorColumn,
        "created_at",
        ...spec.displayFields.map((f) => f.column),
        spec.photosColumn,
        spec.photoColumn,
      ].filter((c): c is string => Boolean(c) && present.has(c as string))
    )
  );
  // Sorting by a column that is not there would throw; created_at is on every
  // one of these tables.
  const dateColumn = present.has(spec.dateColumn) ? spec.dateColumn : "created_at";
  const searchColumns = spec.searchColumns.filter((c) => present.has(c));

  // Photos kept in a child table are aggregated into the same `photo_ids` shape
  // the UI already uses for a uuid[] column, so the two storage layouts are
  // indistinguishable to everything downstream.
  const join = spec.photoJoin;
  const photoIdsSelect = join
    ? sql`, coalesce((
          select array_agg(${sql(join.fileColumn)} order by created_at)
            from ${sql(join.table)}
           where ${sql(join.foreignKey)} = ${sql(spec.table)}.id
             and ${sql(join.fileColumn)} is not null
        ), '{}') as photo_ids`
    : sql``;

  // A text "YYYY-MM-DD" column compares as text; a timestamptz needs a real date
  // bound, and `to` is made exclusive-at-end-of-day so the range includes it.
  // If the text date column was the one missing, the fallback is a timestamptz.
  const dateIsText = Boolean(spec.dateIsText) && dateColumn === spec.dateColumn;
  const { from, to, since, q, limit } = opts;
  const lower = dateIsText ? from : from ? new Date(`${from}T00:00:00+03:00`) : null;
  const upper = dateIsText ? to : to ? new Date(`${to}T00:00:00+03:00`) : null;
  const upperExclusive =
    !dateIsText && upper instanceof Date ? new Date(upper.getTime() + 86_400_000) : upper;

  // The quick range is an INSTANT, not a date, so "last 24 hours" really means
  // the last 24 hours. A text date column can only be compared by day, so it
  // gets the day the range started — the closest true statement available.
  const sinceBound = since ? (dateIsText ? since.toISOString().slice(0, 10) : since) : null;

  return await sql<Record<string, unknown>[]>`
    select ${sql(columns)}${photoIdsSelect}
      from ${sql(spec.table)}
     where ${from ? sql`${sql(dateColumn)} >= ${lower}` : sql`true`}
       and ${to ? sql`${sql(dateColumn)} < ${upperExclusive}` : sql`true`}
       and ${sinceBound ? sql`${sql(dateColumn)} >= ${sinceBound}` : sql`true`}
       and ${
         q && searchColumns.length > 0
           ? sql`(${searchColumns
               .map((c) => sql`coalesce(${sql(c)}::text, '') ilike ${"%" + q + "%"}`)
               .reduce((a, b) => sql`${a} or ${b}`)})`
           : sql`true`
       }
     order by ${sql(dateColumn)} desc, created_at desc
     limit ${limit}
  `;
}
