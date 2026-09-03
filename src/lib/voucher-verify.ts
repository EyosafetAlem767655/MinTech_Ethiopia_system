import sql, { jsonb } from "@/lib/sql";
import { extractVoucherGemini } from "@/lib/llm";
import { getFileBytes } from "@/lib/storage";
import type { VoucherItem } from "@/lib/asset-flows";

/**
 * Checking a typed store issue voucher against its photograph.
 *
 * The store issue flow asks the questions first and takes the photo last. This
 * reads that photo and says where the two disagree — a voucher number that does
 * not match, a line count that does not match, a quantity that does not match.
 *
 * Three rules, all of them load-bearing:
 *
 *  - **It never rewrites anything.** The person standing in the store typed what
 *    they issued; the photo is evidence, not a correction. A "check" that edits
 *    the record to agree with itself has verified nothing.
 *  - **It runs AFTER the reply.** A provider call in the webhook's reply path is
 *    what once left updates unanswered and had Telegram redeliver them forever.
 *  - **A check that could not run is not an accusation.** `checked: false` means
 *    the model was unreachable or the photo unreadable, never that the voucher
 *    is wrong, and the message says so.
 */

export interface VoucherVerification {
  /** False when the read did not happen — NOT a verdict on the voucher. */
  checked: boolean;
  /** 0-100 legibility, straight from the model. */
  confidence: number;
  /** Human-readable disagreements; empty means everything lined up. */
  mismatches: string[];
  /** What the model read, kept so a disputed flag can be re-examined. */
  read?: {
    voucherNo: string;
    itemCount: number;
    items: { description: string; quantity: number }[];
  };
  error?: string;
}

/** Loose text match: case, spaces and punctuation are all noise. */
const norm = (s: string) => String(s || "").toLowerCase().replace(/[\s\-_.,/()]/g, "");

/**
 * Absolute tolerance on a quantity comparison.
 *
 * Zero: these are counted items on a voucher, not weighings. A one-unit
 * difference between the paper and the entry is exactly the kind of slip worth
 * hearing about.
 */
const QTY_TOLERANCE = 0;

/**
 * Compare what was typed against what the photo says.
 *
 * Lines are matched on description rather than position, because the order rows
 * were typed in need not match the order they appear on the pad. A line the
 * model could not find is reported as unmatched rather than as a quantity
 * disagreement — those are different problems with different fixes.
 */
export function compareVoucher(
  typed: VoucherItem[],
  read: { voucherNo: string; items: { description: string; quantity: number }[] },
  typedVoucherNo: string | null
): string[] {
  const mismatches: string[] = [];

  if (typedVoucherNo && read.voucherNo && norm(typedVoucherNo) !== norm(read.voucherNo)) {
    mismatches.push(`የቫውቸር ቁጥር: ${typedVoucherNo} ተብሎ ገብቷል፣ በፎቶው ላይ ${read.voucherNo} ነው።`);
  }

  if (read.items.length > 0 && read.items.length !== typed.length) {
    mismatches.push(`የዕቃ ብዛት: ${typed.length} ገብቷል፣ በፎቶው ላይ ${read.items.length} ይታያል።`);
  }

  const unmatchedReads = [...read.items];
  for (const line of typed) {
    const idx = unmatchedReads.findIndex((r) => norm(r.description) === norm(line.description));
    // A near match, so a slightly differently worded row still compares its
    // quantity rather than being reported as missing.
    const loose =
      idx === -1
        ? unmatchedReads.findIndex(
            (r) =>
              norm(r.description).includes(norm(line.description)) ||
              norm(line.description).includes(norm(r.description))
          )
        : idx;
    if (loose === -1) {
      if (read.items.length > 0) {
        mismatches.push(`"${line.description}" በፎቶው ላይ አልተገኘም።`);
      }
      continue;
    }
    const match = unmatchedReads.splice(loose, 1)[0];
    // A quantity the model could not read comes back as 0 and is skipped: a
    // field it failed on must never surface as a disagreement the reporter has
    // to answer for.
    if (match.quantity > 0 && Math.abs(match.quantity - line.quantity) > QTY_TOLERANCE) {
      mismatches.push(
        `"${line.description}": ${line.quantity.toLocaleString()} ገብቷል፣ ` +
          `በፎቶው ላይ ${match.quantity.toLocaleString()} ነው።`
      );
    }
  }

  for (const extra of unmatchedReads) {
    mismatches.push(`በፎቶው ላይ ያለው "${extra.description}" አልገባም።`);
  }

  return mismatches;
}

/** Persist the verdict, tolerating a database that predates the column. */
async function saveVerification(id: string, v: VoucherVerification): Promise<void> {
  try {
    await sql`update store_issue_vouchers set verification = ${jsonb({ ...v })} where id = ${id}`;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code !== "42703" && code !== "42P01") throw e;
    console.warn("saveVerification: store_issue_vouchers.verification not present yet");
  }
}

/**
 * Read the voucher photo and record whether it agrees with what was typed.
 *
 * Returns the message to send the reporter, or null when there is nothing worth
 * saying — a voucher that matches is not worth a notification.
 */
export async function backgroundVoucherVerify(opts: {
  id: string;
  fileIds: string[];
  typedItems: VoucherItem[];
  voucherNo: string | null;
}): Promise<string | null> {
  if (opts.fileIds.length === 0) return null;

  try {
    const images = [];
    for (const id of opts.fileIds.slice(0, 3)) {
      const f = await getFileBytes(id);
      if (f) images.push({ base64: f.base64, contentType: f.contentType });
    }
    if (images.length === 0) return null;

    const result = await extractVoucherGemini("siv", images);
    if (!result.ok) {
      await saveVerification(opts.id, {
        checked: false,
        confidence: 0,
        mismatches: [],
        error: result.error,
      });
      return "ℹ️ የቫውቸሩን ፎቶ ማንበብ አልተቻለም። ያስገቡት እንደተመዘገበ ነው፤ በእጅ ይጣራል።";
    }

    const read = {
      voucherNo: result.data.voucherNo,
      items: result.data.items.map((i) => ({ description: i.description, quantity: i.quantity })),
    };
    const mismatches = compareVoucher(opts.typedItems, read, opts.voucherNo);

    await saveVerification(opts.id, {
      checked: true,
      confidence: result.data.confidence,
      mismatches,
      read: { ...read, itemCount: read.items.length },
    });

    if (mismatches.length === 0) return null;
    return (
      `⚠️ <b>ፎቶው ካስገቡት ጋር አይመሳሰልም</b>\n` +
      mismatches.slice(0, 6).map((m) => `• ${m}`).join("\n") +
      `\n\n<i>ያስገቡት እንደተመዘገበ ነው። ስህተት ከሆነ በዳሽቦርዱ ላይ ያስተካክሉ።</i>\n` +
      `🤖 የAI እርግጠኝነት: ${result.data.confidence}%`
    );
  } catch (e) {
    console.error("backgroundVoucherVerify failed:", e);
    return null;
  }
}
