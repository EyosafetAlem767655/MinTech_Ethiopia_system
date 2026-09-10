import sharp from "sharp";
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

/**
 * Biggest image, in bytes, that is worth sending to a model as-is.
 *
 * Gemini rejects a request whose total inline payload is too large with a bare
 * HTTP 400, and base64 inflates whatever it wraps by a third. A voucher read
 * sends up to three images, so three of these plus the prompt stays comfortably
 * inside the limit.
 *
 * 2.5MB is far more than any of these reads needs. A receipt, a payment summary
 * and a voucher are all documents photographed close up — legible at 2000px on
 * the long edge, and none of the extra pixels a modern phone camera produces
 * change a digit.
 */
const MAX_MODEL_IMAGE_BYTES = 2_500_000;

/**
 * Shrink an image that is too big to send, leaving everything else untouched.
 *
 * This exists because of how the oversized case FAILS. Telegram compresses a
 * photo sent as a photo, but a phone that uploads from its gallery sends the
 * original as a document — up to 20MB, which becomes ~27MB of base64 and is
 * refused outright. The report was then blocked by a photograph that was too
 * GOOD, which is not a failure anyone would think to look for, and telling a
 * worker at a plant to go and resize a file is not a fix.
 *
 * Failure here is not fatal: an image sharp cannot decode (HEIC without libheif
 * on the runtime, say) is passed through as it was, which is exactly what
 * happened before this function existed.
 */
export async function fitForModel(buffer: Buffer, contentType: string): Promise<LoadedImage> {
  const asIs = { base64: buffer.toString("base64"), contentType };
  // A PDF is not something sharp should touch, and Gemini reads it directly.
  if (buffer.length <= MAX_MODEL_IMAGE_BYTES || !contentType.startsWith("image/")) return asIs;

  try {
    const resized = await sharp(buffer)
      .rotate() // honour EXIF orientation before dropping the metadata
      .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    // Only take the result if it actually helped — a small image blown up by a
    // re-encode is a worse thing to send than the original.
    if (resized.length >= buffer.length) return asIs;
    return { base64: resized.toString("base64"), contentType: "image/jpeg" };
  } catch (e) {
    console.warn("fitForModel: could not resize, sending as-is —", e);
    return asIs;
  }
}

/** Load ONE reference, whichever kind it is. Null when it cannot be resolved. */
export async function loadImage(ref: string): Promise<LoadedImage | null> {
  if (!ref) return null;

  if (isUuid(ref)) {
    const f = await getFileBytes(ref).catch(() => null);
    if (!f) return null;
    return fitForModel(Buffer.from(f.base64, "base64"), f.contentType);
  }

  const dl = await downloadTelegramFile(ref).catch(() => null);
  if (!dl) return null;
  return fitForModel(dl.buffer, contentTypeFor(dl.path));
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
