import ExcelJS from "exceljs";
import { extractReceiptGemini } from "@/lib/llm";

/**
 * Sales report rows — entered field-by-field on the bot or read off a receipt
 * photo by Gemini. Either way the money columns (Sub Total, VAT, Grand Total,
 * Net Payable) are derived in code from qty · unit price · withholding.
 *
 * Report columns: Date · Customer's Name · Product/Qty · Unit Price · Sub Total ·
 * VAT 15% · Grand Total · Withholding · Net Payable · Remark.
 */

/** AI verdict on an attached receipt photo: read quality + figure cross-check. */
export interface ReceiptCheck {
  /**
   * Whether the check actually ran. False means the AI call failed — NOT that
   * anything is wrong with the receipt. Keeping these apart matters: a failed
   * call must never be reported to the salesperson as a rejected receipt.
   */
  checked: boolean;
  score: number; // 0-100 authenticity/legitimacy
  flags: string[];
  reasoning: string;
  extracted: { productTy: string; qty: number; unitPrice: number; grandTotal: number } | null;
  mismatches: string[];
}

export interface SalesReceiptDraft {
  date: string; // YYYY-MM-DD
  customerName: string;
  fsNo: string; // FS No — read off the receipt, never typed
  attNo: string; // Att. No — read off the receipt, never typed
  productTy: string; // product code (ETL-9, 3-EL, EC-15, Talc …)
  qty: number;
  unitPrice: number;
  subTotal: number;
  vat: number;
  grandTotal: number;
  withhold: number; // Withholding
  netPay: number; // Net Pay
  depositedBank: string; // read off the receipt when it shows one
  remark: string;
  /**
   * The Grand Total actually PRINTED on the receipt, when one was read off the
   * photo. Distinct from `grandTotal`, which is always recomputed from
   * qty · unitPrice · 1.15 — comparing that against itself can never detect a
   * receipt whose printed total disagrees with its own line items.
   */
  printedGrandTotal?: number;
}

function toNum(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

export type SalesReceiptReadResult =
  | { ok: true; draft: SalesReceiptDraft; confidence: number; notes: string }
  | { ok: false; error: string };

/**
 * Read a receipt photo into a draft. Gemini is the only reader.
 *
 * There is deliberately no fallback chain here any more. The old one (Gemini →
 * tesseract.js OCR → Qwen-VL) was the direct cause of the scanner hanging: it
 * could run well past the serverless time limit, so the webhook never answered
 * and Telegram redelivered the same update forever. tesseract.js in particular
 * downloads ~15MB of WASM onto a read-only filesystem with no timeout, and can
 * never work in this environment.
 *
 * A failed read returns an error rather than a zeroed draft — a receipt the AI
 * could not read must never be saved as a 0 ETB sale.
 */
export async function extractSalesReceipt(
  images: { base64: string; contentType: string }[],
  caption?: string
): Promise<SalesReceiptReadResult> {
  if (images.length === 0) return { ok: false, error: "no images to read" };

  const res = await extractReceiptGemini(images, caption);
  if (!res.ok) return res;

  const g = res.data;
  // The money columns are always recomputed from qty · unitPrice · withhold so
  // the report is internally consistent, even when the receipt is smudged. What
  // the receipt actually printed is kept separately for the cross-check.
  const draft = computeReceipt({
    date: g.date || new Date().toISOString().slice(0, 10),
    customerName: g.customerName,
    fsNo: g.fsNo,
    attNo: g.attNo,
    productTy: g.productTy,
    qty: toNum(g.qty),
    unitPrice: toNum(g.unitPrice),
    withhold: toNum(g.withhold),
    depositedBank: g.depositedBank,
    remark: "",
  });
  return {
    ok: true,
    draft: { ...draft, printedGrandTotal: toNum(g.grandTotal) || undefined },
    confidence: g.confidence,
    notes: g.notes,
  };
}

/**
 * Cross-check the figures read off the receipt against what was entered by hand.
 * Returns human-readable mismatch strings (empty array = everything agrees).
 * Only compares fields the receipt actually yielded (0/"" means "not read"), and
 * tolerates small rounding differences on money.
 */
export function compareReceipt(entered: SalesReceiptDraft, extracted: SalesReceiptDraft): string[] {
  const out: string[] = [];
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

  if (extracted.productTy && entered.productTy) {
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");
    if (norm(extracted.productTy) !== norm(entered.productTy)) {
      out.push(`product: receipt "${extracted.productTy}" vs entered "${entered.productTy}"`);
    }
  }
  if (extracted.qty > 0 && entered.qty > 0 && !near(extracted.qty, entered.qty, 0.001)) {
    out.push(`qty: receipt ${extracted.qty} vs entered ${entered.qty}`);
  }
  if (extracted.unitPrice > 0 && entered.unitPrice > 0 && !near(extracted.unitPrice, entered.unitPrice, 1)) {
    out.push(`unit price: receipt ${extracted.unitPrice} vs entered ${entered.unitPrice}`);
  }
  // Compare against the total PRINTED on the receipt when we have it. Falling
  // back to `grandTotal` would compare qty × unitPrice × 1.15 on both sides —
  // arithmetic that agrees by construction and can never flag anything.
  const receiptTotal = extracted.printedGrandTotal ?? 0;
  if (receiptTotal > 0 && entered.grandTotal > 0 && !near(receiptTotal, entered.grandTotal, 1)) {
    out.push(`grand total: receipt ${Math.round(receiptTotal)} vs entered ${Math.round(entered.grandTotal)}`);
  }
  return out;
}

/**
 * Recompute the derived money columns from qty · unitPrice · withhold.
 *
 * The identity columns (fsNo, attNo, depositedBank) are pass-through: they can
 * only ever come off the receipt itself, never from arithmetic.
 */
export type ReceiptInput = Pick<
  SalesReceiptDraft,
  "date" | "customerName" | "productTy" | "qty" | "unitPrice" | "withhold" | "remark"
> &
  Partial<Pick<SalesReceiptDraft, "fsNo" | "attNo" | "depositedBank">>;

export function computeReceipt(d: ReceiptInput): SalesReceiptDraft {
  const subTotal = Math.round(d.qty * d.unitPrice * 100) / 100;
  const vat = Math.round(subTotal * 0.15 * 100) / 100;
  const grandTotal = Math.round((subTotal + vat) * 100) / 100;
  const netPay = Math.round((grandTotal - (d.withhold || 0)) * 100) / 100;
  return {
    ...d,
    fsNo: d.fsNo ?? "",
    attNo: d.attNo ?? "",
    depositedBank: d.depositedBank ?? "",
    subTotal,
    vat,
    grandTotal,
    netPay,
  };
}

/* ─────────────────────────────── Excel export ─────────────────────────────── */

export interface SalesReceiptRow {
  date: string | Date;
  customerName: string | null;
  fsNo: string | null;
  attNo: string | null;
  productTy: string | null;
  qty: number | null;
  unitPrice: number | null;
  subTotal: number | null;
  vat: number | null;
  grandTotal: number | null;
  withhold: number | null;
  netPay: number | null;
  depositedBank: string | null;
  remark: string | null;
}

/** The agreed Sales report layout. Column order here is the report's order. */
const HEADERS = [
  "Date",
  "Customers Name",
  "Fs No",
  "Att.No",
  "Product Ty",
  "Qty",
  "Unit Price",
  "Sub Total",
  "Vat 15%",
  "Grand Total",
  "Withhold",
  "Net Pay",
  "Deposited Bank",
  // Not part of the agreed 13, but it is text the salesperson typed and
  // dropping it would silently lose information, so it trails the report.
  "Remark",
];

const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("en-GB");

export async function buildSalesReceiptsWorkbook(rows: SalesReceiptRow[], subtitle: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MinTech Ethiopia";
  wb.created = new Date();
  const ws = wb.addWorksheet("Sales Report");

  ws.addRow(["MIN-TECH ETHIOPIA P.L.C."]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { italic: true };
  ws.addRow(["Sales Report"]);
  ws.addRow([]);
  const head = ws.addRow(HEADERS);
  head.font = { bold: true };

  for (const r of rows) {
    ws.addRow([
      fmtDate(r.date),
      r.customerName ?? "",
      r.fsNo ?? "",
      r.attNo ?? "",
      r.productTy ?? "",
      Number(r.qty) || 0,
      Number(r.unitPrice) || 0,
      Number(r.subTotal) || 0,
      Number(r.vat) || 0,
      Number(r.grandTotal) || 0,
      Number(r.withhold) || 0,
      Number(r.netPay) || 0,
      r.depositedBank ?? "",
      r.remark ?? "",
    ]);
  }

  // Totals row — only the money columns are summable. Qty is deliberately not
  // totalled: rows can be different products, so the sum would be meaningless.
  const n = rows.length;
  const sum = (k: keyof SalesReceiptRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  if (n > 0) {
    const total = ws.addRow([
      "Total",
      "",
      "",
      "",
      "",
      "",
      "",
      sum("subTotal"),
      sum("vat"),
      sum("grandTotal"),
      sum("withhold"),
      sum("netPay"),
      "",
      "",
    ]);
    total.font = { bold: true };
  }

  ws.columns.forEach((c) => (c.width = 14));
  ws.getColumn(2).width = 26; // Customers Name
  ws.getColumn(13).width = 20; // Deposited Bank
  ws.getColumn(14).width = 22; // Remark
  ws.views = [{ state: "frozen", ySplit: 5 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
