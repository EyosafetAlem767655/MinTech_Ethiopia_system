import exifr from "exifr";

export interface ExifCheckResult {
  hasExif: boolean;
  issues: string[];
  raw?: Record<string, unknown>;
}

const EDITOR_SIGNATURES = /photoshop|gimp|snapseed|lightroom|picsart|canva|pixlr|editor/i;

/**
 * EXIF / metadata sanity checks for claim photos.
 * Note: Telegram strips EXIF from compressed photos, which is itself recorded
 * as a finding (claims via Telegram are already auto-flagged for co-signing).
 */
export async function exifSanityCheck(image: Buffer): Promise<ExifCheckResult> {
  const issues: string[] = [];
  let raw: Record<string, unknown> | undefined;
  try {
    raw = (await exifr.parse(image, { tiff: true, exif: true, gps: true })) || undefined;
  } catch {
    raw = undefined;
  }

  if (!raw || Object.keys(raw).length === 0) {
    return { hasExif: false, issues: ["no_exif_metadata"], raw };
  }

  const software = String(raw.Software || raw.software || "");
  if (software && EDITOR_SIGNATURES.test(software)) {
    issues.push(`edited_with_software:${software}`);
  }

  const taken = (raw.DateTimeOriginal || raw.CreateDate) as Date | undefined;
  if (taken instanceof Date) {
    const ageHours = (Date.now() - taken.getTime()) / 3600000;
    if (ageHours > 48) issues.push("photo_older_than_48h");
    if (ageHours < -1) issues.push("camera_clock_in_future");
  } else {
    issues.push("missing_capture_timestamp");
  }

  if (!raw.Make && !raw.Model) issues.push("missing_camera_make_model");

  return { hasExif: true, issues, raw };
}
