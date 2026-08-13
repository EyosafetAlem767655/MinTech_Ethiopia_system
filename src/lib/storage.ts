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

export const BUCKET = "mintech-files";

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
  await client().storage.createBucket(BUCKET, { public: false }).catch(() => {});
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
