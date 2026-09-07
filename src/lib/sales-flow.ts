import { PRODUCT_ORDER, productLabel } from "@/lib/products";
import type { SalesReceiptDraft } from "@/lib/receipt-scan";

/**
 * The sales report flow's shared pieces — the review card, the keyboards, and
 * the rule for which columns still need asking.
 *
 * Lives outside the webhook because the background worker posts the same review
 * card when it finishes reading, and two copies of a card that must match what
 * gets saved is exactly the sort of thing that drifts.
 */

export const SALES_BTN = {
  photosDone: "✅ ጨርሻለሁ",
  approve: "✅ አረጋግጫለሁ",
  edit: "✏️ አስተካክል",
  anotherSale: "➕ ሌላ ሽያጭ",
  finishDay: "🏁 ቀኑን ጨርስ",
  /**
   * The escape hatch out of a read that is not coming back.
   *
   * A model outage must not mean the day's sales cannot be filed at all. This
   * drops into the same field prompts the flow already uses for the columns a
   * successful read could not fill, so there is one way of asking, not two.
   */
  manual: "🖐 በእጅ ሙላ",
} as const;

export const SALES_REVIEW_KEYBOARD = {
  keyboard: [[{ text: SALES_BTN.approve }], [{ text: SALES_BTN.edit }], [{ text: "❌ ተወው" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export const SALES_NEXT_KEYBOARD = {
  keyboard: [[{ text: SALES_BTN.anotherSale }], [{ text: SALES_BTN.finishDay }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

/** Offered while a read is in flight, and after one has given up. */
export const SALES_MANUAL_KEYBOARD = {
  keyboard: [[{ text: SALES_BTN.manual }], [{ text: "❌ ተወው" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

export const SALES_PHOTOS_KEYBOARD = {
  keyboard: [[{ text: SALES_BTN.photosDone }], [{ text: "❌ ተወው" }]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

/** Max documents for one sale: main receipt, WHT receipt, bank slip, spare. */
export const MAX_SALE_DOCUMENTS = 4;

const money = (n: number) => (Math.round((n || 0) * 100) / 100).toLocaleString("en-US");
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Columns that still need a person, in the order they are asked for.
 *
 * Only genuinely missing ones. Asking again for a field the receipt clearly
 * showed is how a flow that was supposed to save time ends up slower than
 * typing the row by hand — which is the flow this one replaced.
 *
 * `withhold` is deliberately absent: 0 is a perfectly normal withholding, so it
 * cannot be distinguished from "not read" and must never be re-asked as though
 * it were missing. A wrong 0 is corrected on the review card like anything else.
 */
export const SALES_REQUIRED_FIELDS = [
  { field: "customerName", prompt: "👤 የደንበኛውን ስም ይፃፉ።" },
  { field: "productTy", prompt: `📦 ምርቱን ይምረጡ።` },
  { field: "qty", prompt: "🔢 ብዛቱን (Qty) በቶን ይፃፉ።" },
  { field: "unitPrice", prompt: "💲 የነጠላ ዋጋውን (Unit Price) ይፃፉ።" },
] as const;

export type SalesRequiredField = (typeof SALES_REQUIRED_FIELDS)[number]["field"];

/** The first column the read could not fill, or null when the row is complete. */
export function firstMissingField(draft: SalesReceiptDraft): SalesRequiredField | null {
  for (const { field } of SALES_REQUIRED_FIELDS) {
    const v = (draft as unknown as Record<string, unknown>)[field];
    if (field === "qty" || field === "unitPrice") {
      if (!Number(v)) return field;
    } else if (!String(v ?? "").trim()) {
      return field;
    }
  }
  return null;
}

/** Product picker, so a code is chosen rather than typed and mistyped. */
export const PRODUCT_KEYBOARD = {
  keyboard: [
    ...chunk(
      PRODUCT_ORDER.map((c) => ({ text: productLabel(c) })),
      3
    ),
    [{ text: "❌ ተወው" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: false,
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The review card — the report row in its own column order, so what is approved
 * is exactly what lands in the table and the Excel file.
 */
export function salesReviewText(draft: SalesReceiptDraft, confidence?: number, notes?: string): string {
  const missing = firstMissingField(draft);
  const printed = draft.printedGrandTotal;
  // A printed total that disagrees with qty × price is the single most useful
  // thing a scan can surface, so it is stated rather than quietly overwritten.
  const mismatch =
    printed && Math.abs(printed - draft.grandTotal) > 1
      ? `\n⚠️ በደረሰኙ ላይ ያለው ጠቅላላ ${money(printed)} ነው — ከሒሳቡ (${money(draft.grandTotal)}) ይለያያል።`
      : "";

  return (
    `🧾 <b>የሽያጭ ሪፖርት</b>\n` +
    `📅 Date: ${esc(draft.date)}\n` +
    `👤 Customer: ${esc(draft.customerName || "—")}\n` +
    `🔖 FS No: ${esc(draft.fsNo || "—")}\n` +
    `🔖 Att. No: ${esc(draft.attNo || "—")}\n` +
    `📦 Product: ${esc(draft.productTy || "—")}\n` +
    `🔢 Qty: ${draft.qty || 0}\n` +
    `💲 Unit Price: ${money(draft.unitPrice)}\n` +
    `➖ Sub Total: ${money(draft.subTotal)}\n` +
    `➕ VAT 15%: ${money(draft.vat)}\n` +
    `💰 Grand Total: ${money(draft.grandTotal)}\n` +
    `📉 Withhold: ${money(draft.withhold)}\n` +
    `✅ Net Pay: ${money(draft.netPay)}\n` +
    `🏦 Bank: ${esc(draft.depositedBank || "—")}\n` +
    `📝 Remark: ${esc(draft.remark || "—")}\n` +
    (confidence !== undefined ? `\n🤖 ንባብ: ${confidence}%${notes ? ` · ${esc(notes)}` : ""}\n` : "") +
    mismatch +
    (missing
      ? `\n\n⚠️ የጎደሉ መስኮች አሉ — በጥያቄ እንሞላቸዋለን።`
      : `\n\nትክክል ከሆነ "${SALES_BTN.approve}"፣ ካልሆነ "${SALES_BTN.edit}" ይጫኑ።`)
  );
}
