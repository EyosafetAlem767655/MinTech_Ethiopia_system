import { geminiGenerate } from "@/lib/llm";
import { computeReceipt, type SalesReceiptDraft } from "@/lib/receipt-scan";

/**
 * Correcting a scanned receipt in plain words.
 *
 * The old parser accepted only `field: value` lines with one of ten hard-coded
 * English keys. Anything else — "the customer is Abebe", a bare product code,
 * an Amharic field name it did not know — fell through the loop untouched, the
 * totals were recomputed from unchanged inputs, and the bot posted back a card
 * identical to the one being corrected. From the salesperson's side the edit
 * simply did nothing, with no explanation. That silence was the bug, more than
 * the narrow parser was.
 *
 * Two rules here, and they matter more than which parser wins:
 *
 *  1. **Every attempt reports what changed**, field by field, old → new.
 *  2. **An attempt that changed nothing says so.** It is never presented as a
 *     successful edit.
 */

/** The fields a person may correct. Everything else is derived. */
export const EDITABLE_FIELDS = [
  "date",
  "customerName",
  "fsNo",
  "attNo",
  "productTy",
  "qty",
  "unitPrice",
  "withhold",
  "depositedBank",
  "remark",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

const NUMERIC_FIELDS = new Set<EditableField>(["qty", "unitPrice", "withhold"]);

/** Human labels, used both in the prompt and in the "what changed" reply. */
export const FIELD_LABEL: Record<EditableField, string> = {
  date: "Date",
  customerName: "Customer",
  fsNo: "FS No",
  attNo: "Att. No",
  productTy: "Product",
  qty: "Qty",
  unitPrice: "Unit Price",
  withhold: "Withhold",
  depositedBank: "Bank",
  remark: "Remark",
};

/** Spellings the fast path accepts, English and Amharic. */
const KEY_ALIASES: Record<string, EditableField> = {
  date: "date",
  ቀን: "date",
  customer: "customerName",
  customername: "customerName",
  ደንበኛ: "customerName",
  fsno: "fsNo",
  fs: "fsNo",
  ፍስ: "fsNo",
  attno: "attNo",
  att: "attNo",
  አትኖ: "attNo",
  product: "productTy",
  productty: "productTy",
  ምርት: "productTy",
  qty: "qty",
  quantity: "qty",
  ብዛት: "qty",
  unitprice: "unitPrice",
  price: "unitPrice",
  ዋጋ: "unitPrice",
  withhold: "withhold",
  withholding: "withhold",
  ውዝፍ: "withhold",
  depositedbank: "depositedBank",
  bank: "depositedBank",
  ባንክ: "depositedBank",
  remark: "remark",
  note: "remark",
  ማስታወሻ: "remark",
};

export interface FieldChange {
  field: EditableField;
  label: string;
  from: string;
  to: string;
}

export interface EditResult {
  draft: SalesReceiptDraft;
  changes: FieldChange[];
  /** True when an AI pass was needed to understand the correction. */
  usedAi: boolean;
  /** Set when the AI pass was needed but could not run. */
  error?: string;
}

const num = (v: string) => Number(String(v).replace(/[^0-9.\-]/g, "")) || 0;

/** Apply a validated `{ field: value }` map, recording what actually moved. */
function applyValues(
  draft: SalesReceiptDraft,
  values: Partial<Record<EditableField, string>>
): { draft: SalesReceiptDraft; changes: FieldChange[] } {
  const next: Record<string, unknown> = { ...draft };
  const changes: FieldChange[] = [];

  for (const field of EDITABLE_FIELDS) {
    const raw = values[field];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const before = String((draft as unknown as Record<string, unknown>)[field] ?? "");
    const value: string | number = NUMERIC_FIELDS.has(field) ? num(String(raw)) : String(raw).trim();
    const after = String(value);
    // A "change" that changes nothing is not reported as one — otherwise
    // re-sending the same correction would look like it had taken effect.
    if (before === after) continue;
    next[field] = value;
    changes.push({ field, label: FIELD_LABEL[field], from: before || "—", to: after });
  }

  return { draft: computeReceipt(next as unknown as SalesReceiptDraft), changes };
}

/**
 * The fast path: `field: value` lines.
 *
 * Kept because it is exact, instant and free — when someone follows the format
 * shown in the prompt, there is no reason to ask a model about it.
 */
export function parseKeyValueEdit(text: string): Partial<Record<EditableField, string>> {
  const out: Partial<Record<EditableField, string>> = {};
  for (const line of String(text || "").split(/\n+/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase().replace(/[.\s_-]/g, "");
    const val = line.slice(idx + 1).trim();
    if (!val) continue;
    const field = KEY_ALIASES[key];
    if (field) out[field] = val;
  }
  return out;
}

const EDIT_SYSTEM =
  "You apply a correction to one row of an Ethiopian sales report and return STRICT JSON only.\n" +
  "You are given the current row and a free-text correction written by the salesperson, in English or " +
  "Amharic. Work out WHICH FIELDS they are correcting and to what.\n" +
  `Return exactly: { ${EDITABLE_FIELDS.map((f) => `"${f}": string`).join(", ")}, "understood": boolean, ` +
  '"notes": string }.\n' +
  "Include ONLY the fields the correction actually changes. Leave every other field out entirely — do " +
  "NOT echo the current values back, because anything you return is treated as an intentional edit.\n" +
  "qty, unitPrice and withhold are numbers written as plain digits with no currency symbol or commas. " +
  "date is YYYY-MM-DD.\n" +
  "Never compute subTotal, vat, grandTotal or netPay — those are derived and must not be returned.\n" +
  'If you cannot tell what is being corrected, return { "understood": false } with no fields. Guessing ' +
  "is worse than asking: a wrong guess is saved as a real sale.";

/**
 * Read a correction, falling back to the model only when the fast path finds
 * nothing.
 *
 * The AI is asked for *only the fields that change*, never the whole row. A
 * model that echoed the row back would silently re-assert every value it
 * misread, turning one correction into ten.
 */
export async function applyReceiptEdit(draft: SalesReceiptDraft, text: string): Promise<EditResult> {
  const direct = parseKeyValueEdit(text);
  if (Object.keys(direct).length > 0) {
    const { draft: next, changes } = applyValues(draft, direct);
    return { draft: next, changes, usedAi: false };
  }

  const res = await geminiGenerate(
    [
      {
        role: "user",
        parts: [
          {
            text:
              `Current row:\n${JSON.stringify(
                Object.fromEntries(
                  EDITABLE_FIELDS.map((f) => [f, (draft as unknown as Record<string, unknown>)[f] ?? ""])
                ),
                null,
                1
              )}\n\nCorrection from the salesperson:\n${String(text).slice(0, 1000)}`,
          },
        ],
      },
    ],
    { json: true, systemInstruction: EDIT_SYSTEM, errorSource: "sales-edit" }
  );

  if (!res.ok || !res.text.trim()) {
    return { draft, changes: [], usedAi: true, error: res.error || "the correction could not be read" };
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(res.text.trim().replace(/```(?:json)?/gi, "")) as Record<string, unknown>;
  } catch {
    return { draft, changes: [], usedAi: true, error: "the correction could not be read" };
  }

  if (parsed.understood === false) return { draft, changes: [], usedAi: true };

  const values: Partial<Record<EditableField, string>> = {};
  for (const field of EDITABLE_FIELDS) {
    const v = parsed[field];
    if (v === undefined || v === null) continue;
    values[field] = String(v);
  }
  const { draft: next, changes } = applyValues(draft, values);
  return { draft: next, changes, usedAi: true };
}

/** The reply that tells the reporter exactly what their correction did. */
export function describeChanges(result: EditResult): string {
  if (result.error) {
    return (
      `⚠️ ማስተካከያውን ማንበብ አልተቻለም። እባክዎ በ"መስክ: እሴት" መልኩ ይላኩ።\n` +
      EDITABLE_FIELDS.map((f) => `• ${f}`).join("\n")
    );
  }
  if (result.changes.length === 0) {
    // The case that used to be silent.
    return (
      `ℹ️ ምንም አልተቀየረም — ማስተካከያውን አልተረዳሁትም።\n\n` +
      `እባክዎ የትኛውን መስክ እንደሚያስተካክሉ ይግለጹ፣ ለምሳሌ "ምርት: 3-EL" ወይም "ብዛት: 120"።\n` +
      `መስኮች፦ ${EDITABLE_FIELDS.join(", ")}`
    );
  }
  return (
    `✏️ <b>${result.changes.length} መስክ ተቀይሯል</b>\n` +
    result.changes.map((c) => `• ${c.label}: ${c.from} → <b>${c.to}</b>`).join("\n")
  );
}
