import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import sql, { first, isUuid, jsonb } from "@/lib/sql";

/**
 * Binary storage. Photos and receipts used to be Buffers embedded in MongoDB
 * documents (a free-tier workaround); they now live in a private Supabase
 * Storage bucket, and Postgres keeps only metadata plus the object path.
 *
 * SERVER ONLY. This uses the secret key, which bypasses RLS and bucket policy.
 * Never import this from a client component.
 */

// Defaults to "mintech-files"; override with STORAGE_BUCKET if your bucket is
// named differently (the name must match EXACTLY, including hyphens).
export const BUCKET = process.env.STORAGE_BUCKET || "mintech-files";

/** The storage `kind` for PP bag damage photos — the only uploads left. */
export const PP_BAG_PHOTO_KIND = "pp_bag_damage";

/**
 * How long a PP bag damage photo is kept, AND how far back duplicates are
 * searched. One constant for both, on purpose: the duplicate check compares
 * against stored hashes and the hashes are deleted with their photos, so a
 * retention longer than the search window keeps images nothing looks at, and a
 * search window longer than the retention promises a comparison that cannot
 * happen.
 *
 * It lives here rather than in pp-bag-damage.ts because that module imports this
 * one; the reverse would be a cycle. It is re-exported from there, which is
 * where it reads as a rule about damage reports rather than about a bucket.
 */
export const PP_BAG_RETENTION_DAYS = 90;

let _client: ReturnType<typeof createClient> | null = null;

function client() {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    _client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _client;
}

function storage() {
  return client().storage.from(BUCKET);
}

let _bucketEnsured = false;
/** Create the private storage bucket if it doesn't exist yet (self-heal, so an
 *  un-provisioned Supabase project doesn't break every photo upload). */
async function ensureBucket(): Promise<void> {
  if (_bucketEnsured) return;
  const { error } = await client().storage.createBucket(BUCKET, { public: false });
  // "already exists" is the happy path on a warm project; anything else is worth
  // logging because it means uploads will keep failing.
  if (error && !/exist/i.test(error.message)) {
    console.error(`ensureBucket(${BUCKET}) failed:`, error.message);
  }
  _bucketEnsured = true;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/** `<kind>/<yyyy>/<mm>/<uuid>.<ext>` — sharded by month so no folder grows unbounded. */
export function buildPath(kind: string, contentType: string, at = new Date()): string {
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const ext = EXT[contentType.toLowerCase()] || "bin";
  return `${kind || "other"}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

export interface StoredFileRow {
  id: string;
  storage_path: string;
  content_type: string;
  filename: string | null;
  kind: string | null;
  phash: string | null;
  exif: Record<string, unknown> | null;
  created_at: Date;
}

/**
 * Uploads bytes, then records the metadata row.
 *
 * Order matters: the row is inserted only after the upload is confirmed, so a
 * failed upload can never leave a dangling reference to an object that isn't
 * there. The reverse order would produce rows pointing at nothing.
 */
export async function putFile(
  data: Buffer,
  contentType: string,
  opts: { kind?: string; filename?: string; phash?: string; exif?: Record<string, unknown> } = {}
): Promise<StoredFileRow> {
  const kind = opts.kind || "other";
  const path = buildPath(kind, contentType);

  let { error } = await storage().upload(path, data, { contentType, upsert: false });
  if (error) {
    // The bucket may not have been provisioned yet — create it and retry once.
    await ensureBucket();
    ({ error } = await storage().upload(path, data, { contentType, upsert: false }));
  }
  if (error) throw new Error(`Storage upload failed (${path}): ${error.message}`);

  try {
    const rows = await sql<StoredFileRow[]>`
      insert into stored_files (storage_path, content_type, filename, kind, phash, exif)
      values (${path}, ${contentType}, ${opts.filename ?? null}, ${kind},
              ${opts.phash ?? null}, ${opts.exif ? jsonb(opts.exif) : null})
      returning *`;
    return rows[0];
  } catch (e) {
    // Don't leave an orphaned object behind if the metadata insert fails.
    await storage().remove([path]).catch(() => {});
    throw e;
  }
}

export async function getFileRow(id: string): Promise<StoredFileRow | null> {
  if (!isUuid(id)) return null; // reject malformed ids before they reach Postgres
  return first(await sql<StoredFileRow[]>`select * from stored_files where id = ${id}`);
}

export async function getFileBytesByPath(path: string): Promise<Buffer> {
  const { data, error } = await storage().download(path);
  if (error || !data) throw new Error(`Storage download failed (${path}): ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Convenience for the OpenAI vision calls, which want base64 + a content type. */
export async function getFileBytes(
  id: string
): Promise<{ buffer: Buffer; base64: string; contentType: string } | null> {
  const row = await getFileRow(id);
  if (!row) return null;
  const buffer = await getFileBytesByPath(row.storage_path);
  return { buffer, base64: buffer.toString("base64"), contentType: row.content_type };
}

export async function deleteFile(id: string): Promise<void> {
  const row = await getFileRow(id);
  if (!row) return;
  await storage().remove([row.storage_path]).catch(() => {});
  await sql`delete from stored_files where id = ${row.id}`;
}

/**
 * How long an uploaded photo is kept AFTER the thing it evidences is decided.
 *
 * The owner's rule (7 Oct 2026): photos go three months after processing. The
 * image is evidence for a decision — was the damage real, should this be
 * bought — so the clock starts when that decision is made, not when the photo
 * arrived. Until then it stays, however old it is: deleting the evidence before
 * anyone has looked at it would leave the decision to be made blind.
 *
 * This replaced two sweeps — 72 hours for dashboard uploads, 90 days from
 * upload for PP bag damage — and a 730-day one for finance receipts that
 * nothing writes any more.
 */
export const PHOTO_KEEP_DAYS = 90;

/**
 * When each photo's subject was decided, or null while it is still undecided.
 *
 *   purchase request → the request decided (`decided_at`)
 *   PP bag damage    → its report decided (0015's status / decided_at)
 *   damage claim     → the claim reviewed (`reviewed_at`)
 *   anything else    → the upload itself (receipts, lot photos, disposals)
 *
 * A photo no record points at any more is dated by its upload: nothing will
 * ever decide it, and an orphan kept forever is just a cost.
 *
 * `to_jsonb(r)->>…` reads the PP bag report's status and decision time so a
 * database that has not run 0015 still sweeps instead of failing at parse time.
 */
function processedPhotos(days: number, withItems: boolean, withBin: boolean) {
  const ppReports = withItems
    ? sql`select report_id from pp_bag_damage_photos where file_id = sf.id
          union select report_id from pp_bag_damage_items where file_id = sf.id`
    : sql`select report_id from pp_bag_damage_photos where file_id = sf.id`;
  const notInBin = withBin
    ? sql`and not exists (select 1 from deleted_submissions d where c.id = any(d.photo_ids))`
    : sql``;
  return sql`
    select c.id, c.storage_path, c.kind, c.processed_at
      from (
        select sf.id, sf.storage_path, sf.kind,
          case
            when sf.kind = 'purchase_request'
                 and exists (select 1 from purchase_requests pr where pr.photo_file_id = sf.id) then
              (select case when bool_or(pr.status in ('pending', 'deferred')) then null
                           else max(coalesce(pr.decided_at, pr.created_at)) end
                 from purchase_requests pr where pr.photo_file_id = sf.id)
            when sf.kind = 'pp_bag_damage'
                 and exists (${ppReports}) then
              (select case when bool_or(coalesce(to_jsonb(r)->>'status', 'pending') = 'pending') then null
                           else max(coalesce((to_jsonb(r)->>'decided_at')::timestamptz, r.created_at)) end
                 from pp_bag_damage_reports r where r.id in (${ppReports}))
            when sf.kind = 'claim_photo'
                 and exists (select 1 from claim_photos cp where cp.file_id = sf.id) then
              (select case when bool_or(dc.status in ('pending', 'cosign_required')) then null
                           else max(coalesce(dc.reviewed_at, dc.created_at)) end
                 from claim_photos cp join damage_claims dc on dc.id = cp.claim_id
                where cp.file_id = sf.id)
            else sf.created_at
          end as processed_at
          from stored_files sf
         where sf.created_at < now() - make_interval(days => ${days})
      ) c
     where true ${notInBin}
  `;
}

/** Run a photo query, stepping down to older schemas rather than stopping the sweep. */
async function withSchemaFallback<T>(run: (withItems: boolean, withBin: boolean) => Promise<T>): Promise<T> {
  // pp_bag_damage_items arrives in 0022 and deleted_submissions in 0018. A
  // reference to a missing table fails at PARSE time, so it cannot be a runtime
  // condition — the query is rebuilt without it instead. Photos of a report in
  // the recycle bin are spared when the bin exists: a restored report that came
  // back without its evidence would not be a restore.
  const attempts: [boolean, boolean][] = [
    [true, true],
    [false, true],
    [false, false],
  ];
  let last: unknown;
  for (const [items, bin] of attempts) {
    try {
      return await run(items, bin);
    } catch (e) {
      if ((e as { code?: string })?.code !== "42P01") throw e;
      last = e;
    }
  }
  throw last;
}

/**
 * Delete one batch of photos whose subject was decided more than `days` ago:
 * the image in the bucket, its stored_files row, and — for PP bag damage — its
 * perceptual-hash row. Only the image goes; the report it belonged to, its
 * figures and its AI verdict stay. Returns how many were removed (0 = done).
 */
export async function purgeProcessedPhotos(days = PHOTO_KEEP_DAYS, batch = 500): Promise<{ deleted: number }> {
  const rows = await withSchemaFallback(
    (items, bin) =>
      sql<{ id: string; storage_path: string }[]>`
        select x.id, x.storage_path
          from (${processedPhotos(days, items, bin)}) x
         where x.processed_at is not null
           and x.processed_at < now() - make_interval(days => ${days})
         limit ${batch}
      `
  );
  if (rows.length === 0) return { deleted: 0 };

  await storage()
    .remove(rows.map((r) => r.storage_path))
    .catch((e) => console.error("purgeProcessedPhotos: storage remove failed:", e));

  const ids = rows.map((r) => r.id);
  // Hash rows first: file_id is ON DELETE SET NULL, so removing stored_files
  // first would orphan hash rows that can never be matched to a file again.
  await sql`delete from pp_bag_damage_photos where file_id = any(${ids})`.catch((e) =>
    console.error("purgeProcessedPhotos: hash rows not removed:", e)
  );
  await sql`delete from stored_files where id = any(${ids})`;
  return { deleted: rows.length };
}

/**
 * Photos older than the keep period that are being kept ONLY because their
 * subject is still undecided — named in the morning summary, because a request
 * nobody has decided in three months is itself something to act on.
 */
export async function undecidedPhotos(days = PHOTO_KEEP_DAYS): Promise<{ kind: string; count: number }[]> {
  try {
    const rows = await withSchemaFallback(
      (items, bin) =>
        sql<{ kind: string | null; n: string }[]>`
          select x.kind, count(*) as n
            from (${processedPhotos(days, items, bin)}) x
           where x.processed_at is null
           group by x.kind
        `
    );
    return rows.map((r) => ({ kind: r.kind || "photo", count: Number(r.n) || 0 }));
  } catch (e) {
    console.error("undecidedPhotos failed:", e);
    return [];
  }
}
