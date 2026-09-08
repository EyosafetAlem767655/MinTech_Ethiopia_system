import { isUuid } from "@/lib/sql";
import { getFileBytes } from "@/lib/storage";
import { downloadTelegramFile } from "@/lib/telegram";

/**
 * Getting image bytes in front of a model, from wherever they happen to live.
 *
 * Almost nothing is uploaded to Supabase Storage any more. A receipt, a voucher,
 * a payment summary, a tool request, a daily report — all read once, and the
 * figures taken off them are the record. Keeping the megabytes as well was
 * paying storage rent on a photograph nobody opens again.
 *
 * What is kept instead is Telegram's own `file_id`. It stays valid indefinitely
 * and resolves back to the original image on demand, so the paperwork is still
 * reachable when a read has to be retried — at no storage cost, because the
 * bytes never left Telegram in the first place.
 *
 * Two kinds of reference therefore exist side by side, and they are told apart
 * by shape rather than by a flag: a UUID is a `stored_files` row — every historic
 * row, plus PP bag damage, the one flow that still uploads, because its
 * perceptual hashes are a three-month duplicate check and a photo that was never
 * stored can never be matched. Anything else is a Telegram file id.
 */

export interface LoadedImage {
  base64: string;
  contentType: string;
}

/**
 * The Telegram file id for an incoming photo — WITHOUT downloading it.
 *
 * Telegram sends a photo as several sizes; the last is the largest, which is the
 * one worth reading. An image sent as a document (which is how a phone gallery
 * sometimes uploads) carries its id in a different place, so both are checked —
 * this mirrors `storeIncomingPhoto`, which PP bag damage still uses.
 */
export function telegramFileId(msg: any): string | null {
  const sizes = msg?.photo as { file_id: string }[] | undefined;
  if (sizes?.length) return sizes[sizes.length - 1].file_id;
  if (msg?.document?.mime_type?.startsWith("image/")) return String(msg.document.file_id);
  return null;
}

/** Content type for a Telegram download, inferred from the file path it returns. */
function contentTypeFor(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "gif") return "image/gif";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

/** Load ONE reference, whichever kind it is. Null when it cannot be resolved. */
export async function loadImage(ref: string): Promise<LoadedImage | null> {
  if (!ref) return null;

  if (isUuid(ref)) {
    const f = await getFileBytes(ref).catch(() => null);
    return f ? { base64: f.base64, contentType: f.contentType } : null;
  }

  const dl = await downloadTelegramFile(ref).catch(() => null);
  if (!dl) return null;
  return { base64: dl.buffer.toString("base64"), contentType: contentTypeFor(dl.path) };
}

/**
 * Load several, skipping the ones that fail.
 *
 * Skipping rather than throwing is deliberate: three of a sale's four documents
 * being readable is a read worth doing, and the caller decides what an empty
 * result means. Every caller already treats zero images as "could not read".
 */
export async function loadImages(refs: (string | null | undefined)[]): Promise<LoadedImage[]> {
  const out: LoadedImage[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    const img = await loadImage(String(ref));
    if (img) out.push(img);
  }
  return out;
}

/**
 * The image references a row carries, from both of its columns.
 *
 * `photo_file_ids` (uuid[]) holds what was uploaded before this change and what
 * PP bag damage still writes; `tg_file_ids` (text[]) holds Telegram ids.
 * A row has one or the other, never both — but reading both means one code path
 * serves old rows and new ones.
 */
export function imageRefs(row: {
  photo_file_ids?: unknown;
  photoFileIds?: unknown;
  tg_file_ids?: unknown;
  tgFileIds?: unknown;
}): string[] {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return [
    ...list(row.photo_file_ids ?? row.photoFileIds),
    ...list(row.tg_file_ids ?? row.tgFileIds),
  ];
}
