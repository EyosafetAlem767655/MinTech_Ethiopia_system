import sql, { first, jsonb } from "@/lib/sql";
import { getFileBytes } from "@/lib/storage";
import { analyseDamagePhoto, type DamagePhotoCheck } from "@/lib/llm";
import { perceptualHash, DUPLICATE_THRESHOLD } from "@/lib/phash";
import { exifSanityCheck } from "@/lib/exif";

/**
 * Evidence pipeline for PP bag damage photos.
 *
 * Deliberately close to src/lib/claims.ts — same hash/EXIF/AI triple, same SQL
 * Hamming search — but scored for this report's own question ("is this photo of
 * genuinely damaged PP bags, and has it been submitted before?") and pointed at
 * this feature's own tables.
 *
 * Runs AFTER the report row is saved and the user has been answered: the AI here
 * is a three-tier fallback chain and must never sit in the webhook's request
 * path.
 */

/** The storage `kind` for these uploads. Excluded from the 72h photo purge. */
export const PP_BAG_PHOTO_KIND = "pp_bag_damage";

/** How far back duplicates are searched, and how long photos are kept. */
export const PP_BAG_RETENTION_DAYS = 365;

export interface PpPhotoResult {
  fileId: string;
  phash?: string;
  duplicateOfReportId?: string;
  ai: DamagePhotoCheck;
  exifCheck: { hasExif: boolean; issues: string[] };
  flags: string[];
}

export interface PpDamageVerdict {
  photos: PpPhotoResult[];
  flags: string[];
  trustScore: number; // 0-100
  /** Merged headline verdict for the report row and the panel. */
  ai: DamagePhotoCheck;
}

/**
 * Has this exact image been submitted before?
 *
 * Postgres computes the Hamming distance itself — the 16-char hex hash casts to
 * bit(64), XOR, popcount — so we never pull every prior hash into Node. Scoped to
 * the retention window, which is what makes the promise "compared across the last
 * year" literally true: older hash rows are deleted, so they cannot match.
 */
async function findDuplicate(phash: string, excludeReportId: string): Promise<string | null> {
  const since = new Date(Date.now() - PP_BAG_RETENTION_DAYS * 86400_000);
  const row = first(
    await sql<{ report_id: string }[]>`
      select p.report_id
        from pp_bag_damage_photos p
       where p.phash is not null
         and p.report_id <> ${excludeReportId}
         and p.created_at >= ${since}
         and bit_count(('x' || lpad(p.phash, 16, '0'))::bit(64)
                     # ('x' || lpad(${phash}, 16, '0'))::bit(64)) <= ${DUPLICATE_THRESHOLD}
       order by p.created_at asc
       limit 1
    `
  );
  return row?.report_id ?? null;
}

async function processOne(
  fileId: string,
  reportId: string,
  reason: string,
  quantity: number
): Promise<PpPhotoResult | null> {
  const file = await getFileBytes(fileId).catch(() => null);
  if (!file) return null;

  const [phash, exifCheck, ai] = await Promise.all([
    perceptualHash(file.buffer).catch(() => undefined),
    exifSanityCheck(file.buffer),
    analyseDamagePhoto({ base64: file.base64, contentType: file.contentType }, reason, quantity),
  ]);

  const flags: string[] = [];
  let duplicateOfReportId: string | undefined;

  if (phash) {
    const dup = await findDuplicate(phash, reportId).catch((e) => {
      // bit_count needs Postgres 14+. Losing the duplicate check must not lose
      // the whole report, so degrade rather than throw.
      console.error("pp bag duplicate search failed:", e);
      return null;
    });
    if (dup) {
      flags.push("duplicate_photo");
      duplicateOfReportId = dup;
    }
  }

  // Telegram strips EXIF from compressed photos, so "no metadata" is the normal
  // case here and is NOT a flag. A capture date that survives and is old is a
  // real signal — this is the one place that check earns its keep.
  if (exifCheck.issues.includes("photo_older_than_48h")) flags.push("photo_older_than_48h");
  if (exifCheck.issues.some((i) => i.startsWith("edited_with_software"))) flags.push("edited_with_software");

  if (!ai.checked) flags.push("ai_not_checked");
  else if (!ai.photoAnalysed) flags.push("photo_not_analysed");
  else if (!ai.plausible) flags.push("suspicious_image");

  return { fileId, phash, duplicateOfReportId, ai, exifCheck, flags };
}

/**
 * Score a whole report. Starts from a neutral 70 like the claim scorer, then
 * moves on evidence. A check that did not run costs nothing — an outage must
 * never look like dishonesty.
 */
function score(photos: PpPhotoResult[]): number {
  if (photos.length === 0) return 50;
  let s = 70;
  const flags = new Set(photos.flatMap((p) => p.flags));

  if (flags.has("duplicate_photo")) s -= 35;
  if (flags.has("photo_older_than_48h")) s -= 15;
  if (flags.has("edited_with_software")) s -= 15;
  if (flags.has("suspicious_image")) s -= 25;

  const judged = photos.filter((p) => p.ai.checked && p.ai.photoAnalysed);
  if (judged.length > 0) {
    const avg = judged.reduce((a, p) => a + p.ai.confidence, 0) / judged.length;
    const allPlausible = judged.every((p) => p.ai.plausible);
    s += allPlausible ? Math.round(avg * 0.25) : -Math.round(avg * 0.2);
  }
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** The verdict shown on the report row: the weakest photo governs. */
function mergeVerdict(photos: PpPhotoResult[]): DamagePhotoCheck {
  const checked = photos.filter((p) => p.ai.checked);
  if (checked.length === 0) {
    return {
      checked: false,
      photoAnalysed: false,
      provider: "none",
      plausible: false,
      confidence: 0,
      observations: "No AI provider was available to check these photos.",
    };
  }
  const worst = checked.reduce((a, b) => {
    if (a.ai.plausible !== b.ai.plausible) return a.ai.plausible ? b : a;
    return a.ai.confidence <= b.ai.confidence ? a : b;
  });
  return {
    ...worst.ai,
    observations: checked.map((p) => p.ai.observations).filter(Boolean).join(" · "),
  };
}

/**
 * Analyse every photo on a saved report, persist the per-photo rows, and update
 * the report's flags and trust score.
 */
export async function processPpDamageReport(
  reportId: string,
  fileIds: string[],
  reason: string,
  quantity: number
): Promise<PpDamageVerdict> {
  const results: PpPhotoResult[] = [];
  // Sequential on purpose: each photo's duplicate search must see the ones
  // already inserted, or two copies of the same image in one submission slip
  // past each other.
  for (const fileId of fileIds.slice(0, 3)) {
    const r = await processOne(fileId, reportId, reason, quantity);
    if (!r) continue;
    results.push(r);
    await sql`
      insert into pp_bag_damage_photos (report_id, file_id, phash, duplicate_of_report_id, ai, exif_check)
      values (${reportId}, ${fileId}, ${r.phash ?? null}, ${r.duplicateOfReportId ?? null},
              ${jsonb(r.ai)}, ${jsonb(r.exifCheck)})
    `;
  }

  const flags = Array.from(new Set(results.flatMap((p) => p.flags)));
  const trustScore = score(results);
  const ai = mergeVerdict(results);

  await sql`
    update pp_bag_damage_reports
       set flags = ${flags}, trust_score = ${trustScore}, ai = ${jsonb(ai)}, updated_at = now()
     where id = ${reportId}
  `;

  return { photos: results, flags, trustScore, ai };
}

/** Amharic summary sent back to the reporter once the check finishes. */
export function ppVerdictMessage(v: PpDamageVerdict): string {
  if (!v.ai.checked) return "⏳ የፎቶ ማጣራት አልተሳካም — በእጅ ይጣራል።";

  const icon = v.trustScore >= 70 ? "🔒" : v.trustScore >= 40 ? "🔎" : "⚠️";
  let out = `${icon} የፎቶ ማጣራት ውጤት፦ <b>${v.trustScore}%</b>\n`;
  if (!v.ai.photoAnalysed) out += "ℹ️ ፎቶው አልተመረመረም (የምስል AI አልነበረም)።\n";
  if (v.flags.includes("duplicate_photo")) out += "❗ ይህ ፎቶ ከዚህ በፊት ቀርቧል።\n";
  if (v.flags.includes("photo_older_than_48h")) out += "❗ ፎቶው ከ48 ሰዓት በላይ ያስቆጠረ ነው።\n";
  if (v.flags.includes("edited_with_software")) out += "❗ ፎቶው በአርታዒ ተስተካክሏል።\n";
  if (v.flags.includes("suspicious_image")) out += "❗ ፎቶው ከሪፖርቱ ጋር አይመሳሰልም።\n";
  return out;
}
