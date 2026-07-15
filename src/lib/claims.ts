import sql, { first, jsonb } from "@/lib/sql";
import { putFile } from "@/lib/storage";
import { checkClaimPhoto, type PhotoVerdict } from "@/lib/llm";
import { perceptualHash, DUPLICATE_THRESHOLD } from "@/lib/phash";
import { exifSanityCheck } from "@/lib/exif";

export interface ClaimPhotoData {
  fileId: string;
  phash?: string;
  duplicateOfClaimId?: string;
  ai: PhotoVerdict;
  exifCheck: { hasExif: boolean; issues: string[] };
}

export interface ProcessedPhoto {
  photo: ClaimPhotoData;
  flags: string[];
  trustScore: number; // 0–100
}

/**
 * Full evidence pipeline for one claim photo:
 *  1. perceptual hash + duplicate lookup, 2. EXIF sanity checks,
 *  3. gpt-4o-mini structured inspection + bag count, 4. store the bytes.
 *
 * reportedCount: the number of damaged bags the worker said they're reporting.
 * The AI independently counts bags and the difference drives the trust score.
 */
export async function processClaimPhoto(
  buffer: Buffer,
  contentType: string,
  bagType: string,
  reportedCount?: number,
  kind = "claim_photo"
): Promise<ProcessedPhoto> {
  const flags: string[] = [];

  const [phash, exifCheck, ai] = await Promise.all([
    perceptualHash(buffer).catch(() => undefined),
    exifSanityCheck(buffer),
    checkClaimPhoto(buffer.toString("base64"), contentType, bagType),
  ]);

  // Duplicate detection.
  //
  // The Mongo version pulled EVERY prior claim-photo hash into Node and did a
  // linear Hamming scan — O(n) per upload, growing forever. Postgres computes
  // the distance itself: the 16-char hex pHash casts to bit(64), XOR, popcount.
  // One indexed round trip, and it hands back the owning claim in the same go.
  let duplicateOfClaimId: string | undefined;
  if (phash) {
    const dup = first(
      await sql<{ claim_id: string }[]>`
        select cp.claim_id
          from claim_photos cp
         where cp.phash is not null
           and bit_count(('x' || lpad(cp.phash, 16, '0'))::bit(64)
                       # ('x' || lpad(${phash}, 16, '0'))::bit(64)) <= ${DUPLICATE_THRESHOLD}
         order by cp.created_at asc
         limit 1
      `
    );
    if (dup) {
      flags.push("duplicate_photo");
      duplicateOfClaimId = dup.claim_id;
    }
  }

  if (ai.suspicious) flags.push("suspicious_image");
  if (!ai.bag_visible || !ai.damage_visible) flags.push("ai_could_not_verify_damage");
  if (exifCheck.issues.some((i) => i.startsWith("edited_with_software"))) flags.push("exif_issue");

  // Count mismatch flag: if AI counted bags and the difference exceeds the ±2 margin
  if (reportedCount !== undefined && ai.aiCountedBags !== null && ai.aiCountedBags !== undefined) {
    if (Math.abs(ai.aiCountedBags - reportedCount) > 2) flags.push("count_mismatch");
  }

  // Trust score: start at 70, adjust by photo quality signals and count match
  let trustScore = 70;
  if (ai.suspicious) trustScore -= 30;
  if (!ai.bag_visible) trustScore -= 15;
  if (!ai.damage_visible) trustScore -= 10;
  if (exifCheck.issues.some((i) => i.startsWith("edited_with_software"))) trustScore -= 10;
  if (flags.includes("duplicate_photo")) trustScore -= 25;

  if (reportedCount !== undefined && ai.aiCountedBags !== null && ai.aiCountedBags !== undefined) {
    const diff = Math.abs(ai.aiCountedBags - reportedCount);
    if (diff <= 2) {
      trustScore += 15; // counts agree within margin
    } else {
      trustScore -= Math.min(25, diff * 4); // penalise proportionally, cap at -25
    }
  }

  trustScore = Math.max(0, Math.min(100, Math.round(trustScore)));

  const stored = await putFile(buffer, contentType, {
    kind,
    phash,
    exif: { hasExif: exifCheck.hasExif, issues: exifCheck.issues },
  });

  return {
    photo: {
      fileId: stored.id,
      phash,
      duplicateOfClaimId,
      ai,
      exifCheck: { hasExif: exifCheck.hasExif, issues: exifCheck.issues },
    },
    flags,
    trustScore,
  };
}

/** Attaches processed photos to a claim (was the embedded `photos[]` array). */
export async function insertClaimPhotos(claimId: string, photos: ClaimPhotoData[]) {
  for (const p of photos) {
    await sql`
      insert into claim_photos (claim_id, file_id, phash, duplicate_of_claim_id, ai, exif_check)
      values (${claimId}, ${p.fileId}, ${p.phash ?? null}, ${p.duplicateOfClaimId ?? null},
              ${jsonb(p.ai as unknown as Record<string, unknown>)},
              ${jsonb(p.exifCheck as unknown as Record<string, unknown>)})
    `;
  }
}

/** Claims with their photos + lot nested back in, matching the old document shape. */
export async function findClaims(opts: { limit?: number; status?: string; id?: string } = {}) {
  const limit = opts.limit ?? 100;
  const where = opts.id
    ? sql`where c.id = ${opts.id}`
    : opts.status
      ? sql`where c.status = ${opts.status}`
      : sql``;
  const rows = await sql`
    select c.id as _id, c.quantity, c.source, c.worker, c.shift, c.status, c.flags,
           c.trust_score as "trustScore", c.ai_counted_bags as "aiCountedBags",
           c.cosigned_by as "cosignedBy", c.reviewed_by as "reviewedBy", c.reviewed_at as "reviewedAt",
           c.captured_at as "capturedAt", c.created_at as "createdAt",
           case when c.gps_lat is null then null else
             jsonb_build_object('lat', c.gps_lat, 'lng', c.gps_lng) end as gps,
           case when c.disposal_action is null then null else jsonb_build_object(
             'action', c.disposal_action, 'amount', c.disposal_amount,
             'photoFileId', c.disposal_photo_file_id,
             'recordedBy', c.disposal_recorded_by, 'recordedAt', c.disposal_recorded_at
           ) end as disposal,
           case when l.id is null then null else jsonb_build_object(
             '_id', l.id, 'lotCode', l.lot_code, 'supplier', l.supplier, 'bagType', l.bag_type
           ) end as "lotId",
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'fileId', p.file_id, 'phash', p.phash,
               'duplicateOfClaimId', p.duplicate_of_claim_id,
               'ai', p.ai, 'exifCheck', p.exif_check
             ) order by p.created_at)
             from claim_photos p where p.claim_id = c.id
           ), '[]'::jsonb) as photos
      from damage_claims c
      left join bag_lots l on l.id = c.lot_id
     ${where}
     order by c.created_at desc
     limit ${limit}
  `;
  return rows;
}
