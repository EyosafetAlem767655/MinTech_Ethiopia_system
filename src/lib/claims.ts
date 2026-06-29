import mongoose from "mongoose";
import { DamageClaim, StoredFile, type IClaimPhoto } from "@/lib/models";
import { checkClaimPhoto } from "@/lib/llm";
import { perceptualHash, hammingDistance, DUPLICATE_THRESHOLD } from "@/lib/phash";
import { exifSanityCheck } from "@/lib/exif";

export interface ProcessedPhoto {
  photo: IClaimPhoto;
  flags: string[];
  trustScore: number; // 0–100
}

/**
 * Full evidence pipeline for one claim photo:
 *  1. store it, 2. perceptual hash + compare against ALL prior claim photos,
 *  3. EXIF/metadata sanity checks, 4. gpt-4o-mini structured inspection + bag count.
 *
 * reportedCount: the number of damaged bags the worker said they're reporting.
 * The AI independently counts bags in the photo and the difference drives the trust score.
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
    trustScore,
  };
}
