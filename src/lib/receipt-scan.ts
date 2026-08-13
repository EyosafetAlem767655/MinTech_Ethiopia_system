import ExcelJS from "exceljs";
import { extractReceiptGemini, isGeminiConfigured, visionAI, VISION_MODEL } from "@/lib/llm";

/**
 * Sales report rows — entered field-by-field on the bot or read off a receipt
 * photo (OCR + Qwen-VL). Either way the money columns (Sub Total, VAT, Grand
 * Total, Net Payable) are derived in code from qty · unit price · withholding.
 *
 * Report columns: Date · Customer's Name · Product/Qty · Unit Price · Sub Total ·
 * VAT 15% · Grand Total · Withholding · Net Payable · Remark.
 */

/** AI verdict on an attached receipt photo: stamp validity + authenticity + cross-check. */
export interface ReceiptCheck {
  hasStamp: boolean; // an unstamped receipt is not valid
  score: number; // 0-100 authenticity/legitimacy
  flags: string[];
  reasoning: string;
  extracted: { productTy: string; qty: number; unitPrice: number; grandTotal: number } | null;
  mismatches: string[];
}

export interface SalesReceiptDraft {
  date: string; // YYYY-MM-DD
  customerName: string;
  productTy: string; // product code (ETL-9, 3-EL, EC-15, Talc …)
  qty: number;
  unitPrice: number;
  subTotal: number;
  vat: number;
  grandTotal: number;
  withhold: number; // Withholding
  netPay: number; // Net Payable
  remark: string;
}

function toNum(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJson(raw?: string | null): any {
  if (!raw) return {};
  let s = String(raw).trim().replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start === -1) return {};
  s = s.slice(start);
  const end = s.lastIndexOf("}");
  try {
    return JSON.parse(end >= 0 ? s.slice(0, end + 1) : s);
  } catch {
    return {};
  }
}

/** Best-effort OCR; returns "" (and lets Qwen do the work) if tesseract can't run. */
async function ocrImage(base64: string): Promise<string> {
  try {
    // Dynamic import so the heavy WASM only loads on this path.
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const { data } = await worker.recognize(Buffer.from(base64, "base64"));
    await worker.terminate();
    return (data.text || "").trim();
  } catch (e) {
    console.error("receipt OCR failed (falling back to Qwen only):", e);
    return "";
  }
}

const RECEIPT_SYSTEM =
  "You read Ethiopian sales receipts / cash-sale invoices for a mining company and return STRICT JSON. " +
  'Return: { "date": "YYYY-MM-DD", "customerName": string, ' +
  '"productTy": string (product type code such as ETL-9, 3-EL, EC-15, Talc), ' +
  '"qty": number, "unitPrice": number (ETB), "withhold": number (ETB withholding if shown, else 0), ' +
  '"remark": string (any note, else "") }. ' +
  "Read numbers exactly. If a field is not visible, use an empty string (or 0 for numbers). " +
  "If OCR text is provided, use it to cross-check the image.";

export async function extractSalesReceipt(
  images: { base64: string; contentType: string }[],
  caption?: string
): Promise<SalesReceiptDraft> {
  // Prefer Gemini when configured — it reads the receipt directly.
  if (isGeminiConfigured() && images.length) {
    const g = await extractReceiptGemini(images, caption).catch(() => null);
    if (g) {
      return computeReceipt({
        date: g.date || new Date().toISOString().slice(0, 10),
        customerName: g.customerName,
        productTy: g.productTy,
        qty: g.qty,
        unitPrice: g.unitPrice,
        withhold: g.withhold,
        remark: "",
      });
    }
  }

  const ocr = images.length ? await ocrImage(images[0].base64) : "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [
    {
      type: "text",
      text:
        "Extract the sales receipt fields." +
        (caption ? `\nCaption: ${caption}` : "") +
        (ocr ? `\nOCR text:\n${ocr.slice(0, 2000)}` : ""),
    },
  ];
  for (const img of images.slice(0, 3)) {
    content.push({ type: "image_url", image_url: { url: `data:${img.contentType};base64,${img.base64}`, detail: "high" } });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let f: any = {};
  try {
    const res = await visionAI().chat.completions.create({
      model: VISION_MODEL,
      max_tokens: 600,
      messages: [
        { role: "system", content: RECEIPT_SYSTEM },
        { role: "user", content },
      ],
    });
    f = parseJson(res.choices[0]?.message?.content);
  } catch (e) {
    console.error("extractSalesReceipt failed:", e);
  }

  return computeReceipt({
    date: String(f.date || new Date().toISOString().slice(0, 10)),
    customerName: String(f.customerName || ""),
    productTy: String(f.productTy || ""),
    qty: toNum(f.qty),
    unitPrice: toNum(f.unitPrice),
    withhold: toNum(f.withhold),
    remark: String(f.remark || ""),
  });
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
  if (extracted.grandTotal > 0 && entered.grandTotal > 0 && !near(extracted.grandTotal, entered.grandTotal, 1)) {
    out.push(`grand total: receipt ${Math.round(extracted.grandTotal)} vs entered ${Math.round(entered.grandTotal)}`);
  }
  return out;
}

/** Recompute the derived money columns from qty · unitPrice · withhold. */
export function computeReceipt(
  d: Pick<SalesReceiptDraft, "date" | "customerName" | "productTy" | "qty" | "unitPrice" | "withhold" | "remark">
): SalesReceiptDraft {
  const subTotal = Math.round(d.qty * d.unitPrice * 100) / 100;
  const vat = Math.round(subTotal * 0.15 * 100) / 100;
  const grandTotal = Math.round((subTotal + vat) * 100) / 100;
  const netPay = Math.round((grandTotal - (d.withhold || 0)) * 100) / 100;
  return { ...d, subTotal, vat, grandTotal, netPay };
}

/* ─────────────────────────────── Excel export ─────────────────────────────── */

export interface SalesReceiptRow {
  date: string | Date;
  customerName: string | null;
  productTy: string | null;
  qty: number | null;
  unitPrice: number | null;
  subTotal: number | null;
  vat: number | null;
  grandTotal: number | null;
  withhold: number | null;
  netPay: number | null;
  remark: string | null;
}

const HEADERS = [
  "Date",
  "Customer's Name",
  "Product/Qty",
  "Unit Price",
  "Sub Total",
  "VAT 15%",
  "Grand Total",
  "Withholding",
  "Net Payable",
  "Remark",
];

const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("en-GB");

/** "ETL-9 / 120" — the combined Product/Qty cell. */
export function productQty(product: string | null, qty: number | null): string {
  const p = (product || "").trim();
  const q = qty == null || qty === 0 ? "" : String(qty);
  if (p && q) return `${p} / ${q}`;
  return p || q || "";
}

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
      productQty(r.productTy, r.qty),
      Number(r.unitPrice) || 0,
      Number(r.subTotal) || 0,
      Number(r.vat) || 0,
      Number(r.grandTotal) || 0,
      Number(r.withhold) || 0,
      Number(r.netPay) || 0,
      r.remark ?? "",
    ]);
  }

  // Totals row
  const n = rows.length;
  const sum = (k: keyof SalesReceiptRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  if (n > 0) {
    const total = ws.addRow([
      "Total",
      "",
      "",
      "",
      sum("subTotal"),
      sum("vat"),
      sum("grandTotal"),
      sum("withhold"),
      sum("netPay"),
      "",
    ]);
    total.font = { bold: true };
  }

  ws.columns.forEach((c) => (c.width = 15));
  ws.getColumn(2).width = 26;
  ws.getColumn(10).width = 22;
  ws.views = [{ state: "frozen", ySplit: 5 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
