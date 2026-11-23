import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { buildExport, isExportDataset, type ExportSheet } from "@/lib/export-datasets";
import { EXPORT_DATASETS } from "@/lib/export-keys";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One sheet: the columns the section declares, in its order, nothing else.
 * Numbers go in as numbers, days as real dates, so the file sorts and sums.
 */
function addSheet(wb: ExcelJS.Workbook, sheet: ExportSheet, used: Set<string>) {
  // Excel: 31 characters, no []:*?/\ and every name different.
  let name = sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Sheet";
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${sheet.name.slice(0, 27)} (${i})`;
  used.add(name.toLowerCase());

  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = sheet.columns.map((c, i) => ({ header: c.header, key: `c${i}` }));

  for (const row of sheet.rows) {
    const out: Record<string, unknown> = {};
    sheet.columns.forEach((c, i) => {
      let v: unknown;
      try {
        v = c.value(row);
      } catch {
        v = null;
      }
      if (v === undefined || v === "" || (typeof v === "number" && !isFinite(v))) v = null;
      if (c.kind === "date" && typeof v === "string" && DAY.test(v)) v = new Date(`${v}T00:00:00Z`);
      else if (c.kind === "number" && v !== null && typeof v !== "number") {
        const n = Number(v);
        v = isFinite(n) ? n : null;
      } else if (v !== null && typeof v === "object" && !(v instanceof Date)) v = null;
      out[`c${i}`] = v;
    });
    ws.addRow(out);
  }

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E9E4" } };
  sheet.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === "number") col.numFmt = "#,##0.###";
    if (c.kind === "date") col.numFmt = "yyyy-mm-dd";
    let width = c.header.length;
    col.eachCell({ includeEmpty: false }, (cell, rowNo) => {
      if (rowNo === 1) return;
      const v = cell.value;
      const len = v instanceof Date ? 10 : String(v ?? "").length;
      if (len > width) width = len;
    });
    col.width = Math.min(Math.max(width + 2, 8), 50);
  });
}

/**
 * GET ?dataset=sales&from=2026-11-01&to=2026-11-15 — the section's records for
 * those days as an .xlsx, one sheet per kind of record.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const dataset = p.get("dataset") || "";
  const from = p.get("from") || "";
  const to = p.get("to") || "";
  if (!isExportDataset(dataset)) return NextResponse.json({ error: "Unknown export." }, { status: 400 });
  if (!DAY.test(from) || !DAY.test(to) || from > to) {
    return NextResponse.json({ error: "Pick a From and a To date, From first." }, { status: 400 });
  }

  const start = new Date(`${from}T00:00:00+03:00`);
  const end = new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86_400_000);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Those dates are not real days." }, { status: 400 });
  }

  try {
    const sheets = await buildExport(dataset, { from, to, start, end });
    const wb = new ExcelJS.Workbook();
    wb.creator = "MinTech";
    wb.created = new Date();
    const used = new Set<string>();
    for (const s of sheets) addSheet(wb, s, used);
    const buffer = await wb.xlsx.writeBuffer();
    const file = `mintech-${dataset}-${from}_to_${to}.xlsx`;
    return new NextResponse(Buffer.from(buffer as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logError({ source: "export/xlsx", kind: "export_failed", message: `${EXPORT_DATASETS[dataset]}: ${message}` }).catch(() => {});
    return NextResponse.json({ error: `The ${EXPORT_DATASETS[dataset]} export failed: ${message}` }, { status: 500 });
  }
}
