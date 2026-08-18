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
      ].filter((c): c is string => Boolean(c))
    )
  );

  // A text "YYYY-MM-DD" column compares as text; a timestamptz needs a real date
  // bound, and `to` is made exclusive-at-end-of-day so the range includes it.
  const lower = spec.dateIsText ? from : from ? new Date(`${from}T00:00:00+03:00`) : null;
  const upper = spec.dateIsText ? to : to ? new Date(`${to}T00:00:00+03:00`) : null;
  const upperExclusive =
    !spec.dateIsText && upper instanceof Date ? new Date(upper.getTime() + 86_400_000) : upper;

  try {
    const rows = await sql`
      select ${sql(columns)}
        from ${sql(spec.table)}
       where ${from ? sql`${sql(spec.dateColumn)} >= ${lower}` : sql`true`}
         and ${to ? sql`${sql(spec.dateColumn)} < ${upperExclusive}` : sql`true`}
         and ${
           q
             ? sql`(${spec.searchColumns
                 .map((c) => sql`coalesce(${sql(c)}::text, '') ilike ${"%" + q + "%"}`)
                 .reduce((a, b) => sql`${a} or ${b}`)})`
             : sql`true`
         }
       order by ${sql(spec.dateColumn)} desc, created_at desc
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
