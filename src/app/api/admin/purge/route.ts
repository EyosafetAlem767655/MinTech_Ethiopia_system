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

type Scope = "sales" | "request_photos" | "asset_management";

/**
 * Every table the Asset Management tab reads, children before parents.
 *
 * Children are listed explicitly even where `on delete cascade` would take them,
 * so the count reported back is honest and a table whose cascade was never
 * declared (the older ones) is not left with orphans. The order matters for the
 * tables WITHOUT a cascade: an item row pointing at a voucher that is gone is a
 * foreign-key error that aborts the delete.
 *
 * GRV vouchers are on this list although Finance reads the same panel: they are
 * what the asset tab shows, and "everything under the tab" means them too.
 * Stated on the card, so nobody learns it afterwards.
 */
const ASSET_TABLES = [
  "goods_receiving_items",
  "goods_receiving_vouchers",
  "store_issue_items",
  "store_issue_vouchers",
  "pp_bag_usage_items",
  "pp_bag_usage",
  "pp_bag_damage_items",
  "pp_bag_damage_photos",
  "pp_bag_damage_reports",
  "purchase_requests",
  "raw_material_receipts",
  "delivery_reports",
  "purchase_item_reports",
  "material_counts",
  "material_issues",
  "claim_photos",
  "damage_claims",
  "bag_lots",
] as const;

/** Registry keys of those tables, so their recycle-bin entries go with them. */
const ASSET_COLLECTIONS = [
  "grv",
  "store_issue",
  "pp_bag_usage",
  "pp_bag_damage",
  "tool_request",
  "raw_material",
  "delivery",
  "purchase_items",
  "materials",
  "material_issue",
  "damage_claim",
];

/**
 * Rows in one table, or 0 when the table is not in this database.
 *
 * Deployments run ahead of their migrations here, and a purge that aborted on
 * the first table it could not find would leave the other seventeen untouched
 * and report nothing useful about why.
 */
async function countRows(table: string): Promise<number> {
  const rows = await sql
    .unsafe<{ n: string }[]>(`select count(*) as n from "${table}"`)
    .catch(() => [{ n: "0" }]);
  return Number(rows[0]?.n) || 0;
}

async function deleteRows(table: string): Promise<number> {
  // `unsafe` because the table name varies and postgres.js's sql() helper
  // cannot take a table identifier in this position (see insert.ts). The names
  // come from the constant list above, never from the request.
  const result = await sql.unsafe(`delete from "${table}"`).catch((e) => {
    if ((e as { code?: string })?.code !== "42P01") console.error(`purge: delete from ${table} failed:`, e);
    return { count: 0 };
  });
  return (result as { count?: number }).count ?? 0;
}

/**
 * Everything the Asset Management tab shows: the rows, their line items and
 * photos, the PP bag damage images in the bucket, and their recycle-bin entries.
 *
 * The bin entries are not an afterthought. Leaving them would show a "restore"
 * button for reports that had just been deliberately wiped, and restoring one
 * would bring back a voucher whose line items no longer exist.
 */
async function purgeAssetManagement() {
  // Files first, while the rows that name them still exist. PP bag damage is the
  // only asset flow that uploads; purchase-request photos are the older uuid
  // column, swept the same way. Telegram file ids are not ours to remove.
  const fileRows = await sql<{ id: string }[]>`
    select id from stored_files where kind = 'pp_bag_damage'
    union
    select photo_file_id as id from purchase_requests where photo_file_id is not null
  `.catch(async () => {
    // purchase_requests.photo_file_id may be gone on a newer schema; fall back
    // to the bucket kind alone rather than sweeping nothing.
    return await sql<{ id: string }[]>`select id from stored_files where kind = 'pp_bag_damage'`.catch(() => []);
  });
  const filesRemoved = await removeFiles(fileRows.map((r) => String(r.id)));

  const deleted: Record<string, number> = {};
  for (const table of ASSET_TABLES) deleted[table] = await deleteRows(table);

  const bin = await sql`
    delete from deleted_submissions where collection = any(${ASSET_COLLECTIONS})
  `.catch(() => ({ count: 0 }));

  const rowsDeleted = Object.values(deleted).reduce((a, n) => a + n, 0);
  return {
    scope: "asset_management" as const,
    rowsDeleted,
    perTable: deleted,
    binEntriesDeleted: (bin as { count?: number }).count ?? 0,
    filesRemoved,
    filesReferenced: fileRows.length,
  };
}

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
 * Every sales row, and the cached brief.
 *
 * No files to remove: a sale's receipts are read once and never stored or
 * referenced, so there is nothing in the bucket to sweep. `filesRemoved` stays
 * in the response as a zero rather than disappearing, so the UI reads the same
 * either way.
 *
 * The brief row is not incidental. The landing page renders it directly, so
 * leaving it would have the dashboard quoting sales figures whose reports had
 * just been deleted — the one screen most likely to be looked at right after
 * this runs.
 */
async function purgeSales() {
  const deleted = await sql`delete from sales_invoices`.catch(() => ({ count: 0 }));
  const briefs = await sql`delete from briefs`.catch(() => ({ count: 0 }));

  return {
    scope: "sales" as const,
    receiptsDeleted: (deleted as { count?: number }).count ?? 0,
    briefsDeleted: (briefs as { count?: number }).count ?? 0,
    filesRemoved: 0,
    filesReferenced: 0,
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
  const [sales, briefs, requests, assetCounts, assetFiles] = await Promise.all([
    sql<{ n: string }[]>`select count(*) as n from sales_invoices`.catch(() => [{ n: "0" }]),
    sql<{ n: string }[]>`select count(*) as n from briefs`.catch(() => [{ n: "0" }]),
    sql<{ n: string }[]>`
      select count(*) as n from purchase_requests where photo_file_id is not null
    `.catch(() => [{ n: "0" }]),
    Promise.all(ASSET_TABLES.map((t) => countRows(t))),
    sql<{ n: string }[]>`select count(*) as n from stored_files where kind = 'pp_bag_damage'`.catch(() => [{ n: "0" }]),
  ]);

  const perTable = Object.fromEntries(ASSET_TABLES.map((t, i) => [t, assetCounts[i]]));
  return NextResponse.json({
    sales: { receipts: Number(sales[0]?.n) || 0, briefs: Number(briefs[0]?.n) || 0 },
    request_photos: { photos: Number(requests[0]?.n) || 0 },
    asset_management: {
      rows: assetCounts.reduce((a, n) => a + n, 0),
      perTable,
      files: Number(assetFiles[0]?.n) || 0,
    },
  });
}

const SCOPES: Record<Scope, () => Promise<Record<string, unknown>>> = {
  sales: purgeSales,
  request_photos: purgeRequestPhotos,
  asset_management: purgeAssetManagement,
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { scope?: string; confirm?: string };
  const scope = body.scope as Scope | undefined;

  if (!scope || !(scope in SCOPES)) {
    return NextResponse.json({ error: "Unknown scope." }, { status: 400 });
  }
  // The typed confirmation is checked on the server as well as in the UI. A
  // destructive endpoint that trusts its own form is one curl away from being
  // called without one.
  if (body.confirm !== scope) {
    return NextResponse.json({ error: `Type "${scope}" to confirm.` }, { status: 400 });
  }

  const result = await SCOPES[scope]();
  return NextResponse.json({ ok: true, ...result });
}
