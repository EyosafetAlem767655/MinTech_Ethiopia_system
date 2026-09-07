import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { deleteFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Deliberate, scoped data removal.
 *
 * There are already wipe scripts under supabase/, and they are still there — but
 * SQL run in the Supabase editor cannot reach the storage bucket. It deletes the
 * rows and leaves the objects behind, paying storage rent forever on images
 * nothing references. This route does both halves.
 *
 * Behind the dashboard password: middleware.ts guards every /api path that is
 * not in PUBLIC_PREFIXES, and this one is not.
 *
 * Nothing here is recoverable. Each scope is narrow and named for exactly what
 * it removes, so there is no "clear everything" to reach for by accident.
 */

type Scope = "sales" | "request_photos";

/** Remove stored files by id: the bucket object first, then the metadata row. */
async function removeFiles(ids: string[]): Promise<number> {
  let removed = 0;
  for (const id of ids) {
    // deleteFile is per-file rather than batched because a single unreachable
    // object must not stop the rest — a half-finished purge that reports what it
    // managed is more useful than one that aborts on the first missing file.
    await deleteFile(id)
      .then(() => {
        removed += 1;
      })
      .catch(() => {});
  }
  return removed;
}

/**
 * Every sales report, its images and the cached brief.
 *
 * The brief row is not incidental. The landing page renders it directly, so
 * leaving it would have the dashboard quoting sales figures whose receipts had
 * just been deleted — the one screen most likely to be looked at right after
 * this runs.
 */
async function purgeSales() {
  const rows = await sql<{ ids: string[] | null }[]>`
    select coalesce(array_agg(f), '{}') as ids
      from (select unnest(photo_file_ids) as f from sales_receipts) s
  `.catch(() => []);
  const fileIds = (rows[0]?.ids ?? []).map(String).filter(Boolean);

  const filesRemoved = await removeFiles(fileIds);

  const deleted = await sql`delete from sales_receipts`.catch(() => ({ count: 0 }));
  const briefs = await sql`delete from briefs`.catch(() => ({ count: 0 }));

  return {
    scope: "sales" as const,
    receiptsDeleted: (deleted as { count?: number }).count ?? 0,
    briefsDeleted: (briefs as { count?: number }).count ?? 0,
    filesRemoved,
    // Rows whose file had already been swept by the 72-hour purge are counted
    // here, so "5 rows, 3 files" is an expected result rather than a discrepancy.
    filesReferenced: fileIds.length,
  };
}

/**
 * The photos attached to purchase requests — the Tool requests panel.
 *
 * The REQUEST ROWS STAY. What was asked for, by whom, and what was decided is
 * the record; the photograph was only ever supporting evidence, and removing it
 * is what was asked for.
 */
async function purgeRequestPhotos() {
  const rows = await sql<{ id: string; photo_file_id: string }[]>`
    select id, photo_file_id from purchase_requests where photo_file_id is not null
  `.catch(() => []);

  const filesRemoved = await removeFiles(rows.map((r) => String(r.photo_file_id)));

  // Nulled after the files are gone, not before: the ids are the only way back
  // to the objects, so losing them first would orphan every one of them.
  await sql`update purchase_requests set photo_file_id = null where photo_file_id is not null`.catch(() => {});

  return {
    scope: "request_photos" as const,
    requestsAffected: rows.length,
    filesRemoved,
    filesReferenced: rows.length,
  };
}

/** GET — what each scope would remove. Nothing is deleted. */
export async function GET() {
  const [sales, briefs, requests] = await Promise.all([
    sql<{ n: string }[]>`select count(*) as n from sales_receipts`.catch(() => [{ n: "0" }]),
    sql<{ n: string }[]>`select count(*) as n from briefs`.catch(() => [{ n: "0" }]),
    sql<{ n: string }[]>`
      select count(*) as n from purchase_requests where photo_file_id is not null
    `.catch(() => [{ n: "0" }]),
  ]);

  return NextResponse.json({
    sales: { receipts: Number(sales[0]?.n) || 0, briefs: Number(briefs[0]?.n) || 0 },
    request_photos: { photos: Number(requests[0]?.n) || 0 },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { scope?: string; confirm?: string };
  const scope = body.scope as Scope | undefined;

  if (scope !== "sales" && scope !== "request_photos") {
    return NextResponse.json({ error: "Unknown scope." }, { status: 400 });
  }
  // The typed confirmation is checked on the server as well as in the UI. A
  // destructive endpoint that trusts its own form is one curl away from being
  // called without one.
  if (body.confirm !== scope) {
    return NextResponse.json({ error: `Type "${scope}" to confirm.` }, { status: 400 });
  }

  const result = scope === "sales" ? await purgeSales() : await purgeRequestPhotos();
  return NextResponse.json({ ok: true, ...result });
}
