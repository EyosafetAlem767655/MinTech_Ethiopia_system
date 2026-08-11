import ExcelJS from "exceljs";
import { visionAI, VISION_MODEL } from "@/lib/llm";

/**
 * Sales receipt scanner: OCR (best-effort tesseract) + Qwen-VL to read the key
 * fields off a photographed receipt, then compute the money columns in code.
 * VAT/Grand/Net are derived, so only a handful of fields need reading.
 */

export interface SalesReceiptDraft {
  date: string; // YYYY-MM-DD
  customerName: string;
  fsNo: string;
  attNo: string;
  productTy: string;
  qty: number;
  unitPrice: number;
  subTotal: number;
  vat: number;
  grandTotal: number;
  withhold: number;
  netPay: number;
  depositedBank: string;
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
  'Return: { "date": "YYYY-MM-DD", "customerName": string, "fsNo": string (the Fs.No / receipt number), ' +
  '"attNo": string (the Att.No / attached voucher or TIN number), "productTy": string (product type code such as ETL-9, 3-EL, EC-15, Talc), ' +
  '"qty": number, "unitPrice": number (ETB), "withhold": number (ETB withholding if shown, else 0), ' +
  '"depositedBank": string (bank name/abbreviation such as CBE, Awash, Dashen, if shown) }. ' +
  "Read numbers exactly. If a field is not visible, use an empty string (or 0 for numbers). " +
  "If OCR text is provided, use it to cross-check the image.";

export async function extractSalesReceipt(
  images: { base64: string; contentType: string }[],
  caption?: string
): Promise<SalesReceiptDraft> {
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
    fsNo: String(f.fsNo || ""),
    attNo: String(f.attNo || ""),
    productTy: String(f.productTy || ""),
    qty: toNum(f.qty),
    unitPrice: toNum(f.unitPrice),
    withhold: toNum(f.withhold),
    depositedBank: String(f.depositedBank || ""),
  });
}

/** Recompute the derived money columns from qty · unitPrice · withhold. */
export function computeReceipt(
  d: Pick<SalesReceiptDraft, "date" | "customerName" | "fsNo" | "attNo" | "productTy" | "qty" | "unitPrice" | "withhold" | "depositedBank">
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
}

const HEADERS = [
  "Date",
  "Customer Name",
  "Fs.No",
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
];

const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString("en-GB");

export async function buildSalesReceiptsWorkbook(rows: SalesReceiptRow[], subtitle: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MinTech Ethiopia";
  wb.created = new Date();
  const ws = wb.addWorksheet("Sales Report");

  ws.addRow(["MIN-TECH ETHIOPIA P.L.C."]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { italic: true };
  ws.addRow(["Cash Sales"]);
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
      "",
      sum("qty"),
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
  ws.views = [{ state: "frozen", ySplit: 5 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
