import mongoose from "mongoose";
import { DamageClaim, StoredFile, type IClaimPhoto } from "@/lib/models";
import { checkClaimPhoto } from "@/lib/llm";
import { perceptualHash, hammingDistance, DUPLICATE_THRESHOLD } from "@/lib/phash";
import { exifSanityCheck } from "@/lib/exif";

export interface ProcessedPhoto {
  photo: IClaimPhoto;
  flags: string[];
}

/**
 * Full evidence pipeline for one claim photo:
 *  1. store it, 2. perceptual hash + compare against ALL prior claim photos,
 *  3. EXIF/metadata sanity checks, 4. gpt-4o-mini structured inspection.
 */
export async function processClaimPhoto(
  buffer: Buffer,
  contentType: string,
  bagType: string,
  kind = "claim_photo"
): Promise<ProcessedPhoto> {
  const flags: string[] = [];

  const [phash, exifCheck, ai] = await Promise.all([
    perceptualHash(buffer).catch(() => undefined),
    exifSanityCheck(buffer),
    checkClaimPhoto(buffer.toString("base64"), contentType, bagType),
  ]);

  // Compare against every prior stored claim photo hash.
  let duplicateOfClaimId: mongoose.Types.ObjectId | undefined;
  if (phash) {
    const priorFiles = await StoredFile.find({ kind: "claim_photo", phash: { $exists: true } })
      .select("phash")
      .lean();
    const dupFile = priorFiles.find((f) => f.phash && hammingDistance(f.phash, phash) <= DUPLICATE_THRESHOLD);
    if (dupFile) {
      flags.push("duplicate_photo");
      const owner = await DamageClaim.findOne({ "photos.fileId": dupFile._id }).select("_id").lean();
      if (owner) duplicateOfClaimId = owner._id as mongoose.Types.ObjectId;
    }
  }

  if (ai.suspicious) flags.push("suspicious_image");
  if (!ai.bag_visible || !ai.damage_visible) flags.push("ai_could_not_verify_damage");
  if (exifCheck.issues.some((i) => i.startsWith("edited_with_software"))) flags.push("exif_issue");

  const stored = await StoredFile.create({
    data: buffer,
    contentType,
    kind,
    phash,
    exif: { hasExif: exifCheck.hasExif, issues: exifCheck.issues },
  });

  return {
    photo: {
      fileId: stored._id,
      phash,
      duplicateOfClaimId,
      ai,
      exifCheck: { hasExif: exifCheck.hasExif, issues: exifCheck.issues },
    },
    flags,
  };
}
