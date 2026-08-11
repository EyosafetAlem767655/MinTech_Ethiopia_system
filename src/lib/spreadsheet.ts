import ExcelJS from "exceljs";

/**
 * Reads the first worksheet of an .xlsx buffer into a compact CSV-like text block
 * so the LLM ingestion (classifyIngestion) can extract a report from an Excel
 * upload exactly as it does from pasted text. Blank rows are dropped; each cell
 * is tab-separated. Capped so a huge sheet can't blow the token budget.
 */
export async function spreadsheetToText(buffer: Buffer, maxRows = 120): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return "";

  const lines: string[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (lines.length >= maxRows) return;
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      let text = "";
      if (v == null) text = "";
      else if (typeof v === "object" && "result" in v) text = String((v as { result: unknown }).result ?? "");
      else if (typeof v === "object" && "text" in v) text = String((v as { text: unknown }).text ?? "");
      else text = String(v);
      cells.push(text.trim());
    });
    const line = cells.join("\t").trim();
    if (line) lines.push(line);
  });

  return lines.join("\n");
}

/** True for Telegram document mime types we can parse as a spreadsheet. */
export function isSpreadsheetMime(mime?: string, filename?: string): boolean {
  const m = (mime || "").toLowerCase();
  const f = (filename || "").toLowerCase();
  return (
    m.includes("spreadsheetml") || // .xlsx
    m === "application/vnd.ms-excel" || // .xls
    f.endsWith(".xlsx") ||
    f.endsWith(".xls")
  );
}
