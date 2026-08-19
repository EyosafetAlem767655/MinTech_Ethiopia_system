import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { isSubmissionCollection, SUBMISSIONS, SUBMISSION_COLLECTIONS } from "@/lib/submissions";

export const dynamic = "force-dynamic";

/**
 * GET — one collection of bot submissions, newest first.
 *
 * Every table/column name comes from the registry after the collection has been
 * validated against a closed enum, so nothing user-supplied ever reaches an
 * identifier position; the values still go through postgres.js parameters, and
 * identifiers through `sql()` which quotes them.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const collection = p.get("collection") || "daily";
  if (!isSubmissionCollection(collection)) {
    return NextResponse.json(
      { error: `Unknown collection. Expected one of: ${SUBMISSION_COLLECTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  const spec = SUBMISSIONS[collection];
  const limit = Math.min(Number(p.get("limit")) || 60, 200);
  const from = p.get("from") || "";
  const to = p.get("to") || "";
  const q = (p.get("q") || "").trim();

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
  if (present.size === 0) {
    return NextResponse.json({ collection, rows: [], unavailable: true });
  }

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
  const lower = dateIsText ? from : from ? new Date(`${from}T00:00:00+03:00`) : null;
  const upper = dateIsText ? to : to ? new Date(`${to}T00:00:00+03:00`) : null;
  const upperExclusive =
    !dateIsText && upper instanceof Date ? new Date(upper.getTime() + 86_400_000) : upper;

  try {
    const rows = await sql`
      select ${sql(columns)}${photoIdsSelect}
        from ${sql(spec.table)}
       where ${from ? sql`${sql(dateColumn)} >= ${lower}` : sql`true`}
         and ${to ? sql`${sql(dateColumn)} < ${upperExclusive}` : sql`true`}
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
    return NextResponse.json({ collection, rows });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // A table or column from a migration that has not been applied yet must not
    // 500 the whole screen — report it as empty and say why.
    if (code === "42P01" || code === "42703") {
      console.warn(`submissions: ${spec.table} not ready (${code})`);
      return NextResponse.json({ collection, rows: [], unavailable: true });
    }
    throw e;
  }
}
