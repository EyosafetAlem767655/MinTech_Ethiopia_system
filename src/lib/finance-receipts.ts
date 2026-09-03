import sql from "@/lib/sql";
import { extractReceiptGemini, type GeminiReceipt } from "@/lib/llm";
import { getFileBytes } from "@/lib/storage";
import { jsonb } from "@/lib/sql";

/**
 * Reading a purchase receipt and checking it against what was typed.
 *
 * The same idea as the sales receipt scanner, applied to money going out rather
 * than in: whoever files a purchase types a total, and the photographed receipt
 * either agrees with it or does not.
 *
 * Two rules carried over from that module, both learned expensively:
 *
 *  - **This never runs inside the webhook's reply path.** A provider call there
 *    is what once left updates unanswered and had Telegram redeliver them
 *    forever. It runs after the report is saved and the user has been answered.
 *  - **A check that could not run is not an accusation.** `checked: false` means
 *    the AI failed, never that the receipt is fake, and the wording says so.
 */

/** Storage kind for purchase receipts — excluded from the 72-hour photo purge. */
export const FINANCE_RECEIPT_KIND = "finance_receipt";

export interface PurchaseReceiptCheck {
  /** False when the model could not be reached — NOT a verdict on the receipt. */
  checked: boolean;
  /** 0-100 legibility/confidence, straight from the model. */
  score: number;
  flags: string[];
  reasoning: string;
  /** The total printed on the paper, as read. */
  printedTotal: number | null;
  /** Human-readable disagreements; empty means everything lined up. */
  mismatches: string[];
}

/** Absolute tolerance on a money comparison, in whole currency units. */
const MONEY_TOLERANCE = 1;

/**
 * Compare the typed batch total against the receipt.
 *
 * Only the total is compared. A batch covers several items under one figure, so
 * there is nothing per-item to check against, and the receipt's own line items
 * may be worded nothing like the descriptions that were typed.
 *
 * A total the model could not read comes back as 0 and is skipped — a field it
 * failed on must never surface as a disagreement the reporter has to answer for.
 */
export function comparePurchaseTotal(
  enteredTotal: number,
  printedTotal: number | null
): string[] {
  if (!printedTotal || printedTotal <= 0) return [];
  if (!enteredTotal || enteredTotal <= 0) return [];
  if (Math.abs(enteredTotal - printedTotal) <= MONEY_TOLERANCE) return [];
  return [
    `የተፃፈው ጠቅላላ ${enteredTotal.toLocaleString()} ሲሆን በደረሰኙ ላይ ${printedTotal.toLocaleString()} ነው።`,
  ];
}

function buildCheck(
  read: { ok: true; data: GeminiReceipt } | { ok: false; error: string },
  enteredTotal: number
): PurchaseReceiptCheck {
  if (!read.ok) {
    return {
      checked: false,
      score: 0,
      flags: ["ai_check_failed"],
      reasoning: read.error,
      printedTotal: null,
      mismatches: [],
    };
  }
  const printedTotal = Number(read.data.grandTotal) || null;
  return {
    checked: true,
    score: read.data.confidence,
    flags: [],
    reasoning: read.data.notes || "",
    printedTotal,
    mismatches: comparePurchaseTotal(enteredTotal, printedTotal),
  };
}

/** Persist the verdict, tolerating a database that predates the column. */
async function saveCheck(table: string, id: string, check: PurchaseReceiptCheck): Promise<void> {
  try {
    await sql`update ${sql(table)} set receipt_check = ${jsonb({ ...check })} where id = ${id}`;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code !== "42703" && code !== "42P01") throw e;
    console.warn(`saveCheck: ${table}.receipt_check not present yet`);
  }
}

/**
 * Read the receipts attached to a purchase and record the verdict.
 *
 * Returns the message to send the reporter, or null when there is nothing worth
 * saying — a clean check is not worth a notification.
 */
export async function backgroundPurchaseReceiptCheck(opts: {
  table: "goods_receiving_vouchers" | "finance_purchase_batches" | "pp_bag_purchases";
  id: string;
  fileIds: string[];
  enteredTotal: number;
  currency: string;
}): Promise<string | null> {
  if (opts.fileIds.length === 0) return null;

  try {
    const images = [];
    for (const id of opts.fileIds.slice(0, 3)) {
      const f = await getFileBytes(id);
      if (f) images.push({ base64: f.base64, contentType: f.contentType });
    }
    if (images.length === 0) return null;

    const read = await extractReceiptGemini(images);
    const check = buildCheck(read, opts.enteredTotal);
    await saveCheck(opts.table, opts.id, check);

    if (!check.checked) {
      return "ℹ️ የደረሰኙን ማጣራት ማጠናቀቅ አልተቻለም። ሪፖርቱ ተመዝግቧል፤ በእጅ ይጣራል።";
    }
    if (check.mismatches.length > 0) {
      return (
        `⚠️ <b>የደረሰኙ ልዩነት</b>\n` +
        check.mismatches.map((m) => `• ${m}`).join("\n") +
        `\n\n🤖 የAI እርግጠኝነት: ${check.score}%`
      );
    }
    return null;
  } catch (e) {
    console.error("backgroundPurchaseReceiptCheck failed:", e);
    return null;
  }
}
