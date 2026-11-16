import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { buildExport, isExportDataset, type ExportSheet } from "@/lib/export-datasets";
import { EXPORT_DATASETS } from "@/lib/export-keys";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Plumbing no reader of the sheet needs: ids, file handles, hashes, bot drafts. */
function hidden(key: string): boolean {
  return (
    key === "id" ||
    key === "_id" ||
    /(_id|Id)$/.test(key) ||
    /_ids$/.test(key) ||
    /(^|_)(hash|draft|file|files)$/.test(key) ||
    key === "photo_file_ids" ||
    key === "tg_file_ids"
  );
}

/** "reported_by" / "reportedBy" → "Reported by". Product codes stay as they are. */
function heading(key: string): string {
  return key
    .split(" · ")
    .map((part) => {
      if (/^[A-Z0-9@.\- ]+$/.test(part) || /@/.test(part)) return part.replace("@", " · ");
      const words = part.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(" · ");
}

/** A Date in EAT: the day alone when it is a stored calendar day, else day and time. */
function eat(d: Date): string {
  const s = new Date(d.getTime() + 3 * 3_600_000).toISOString();
  const time = s.slice(11, 16);
  return time === "03:00" || time === "00:00" ? s.slice(0, 10) : `${s.slice(0, 10)} ${time}`;
}

/** One row flattened: nested objects become "Parent · key" columns, lists become text. */
function flatten(row: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(row)) {
    if (hidden(k)) continue;
    const key = prefix ? `${prefix} · ${k}` : k;
    if (v instanceof Date) out[key] = eat(v);
    else if (Array.isArray(v)) {
      out[key] = v
        .map((x) => (x && typeof x === "object" ? Object.entries(x).filter(([kk]) => !hidden(kk)).map(([kk, vv]) => `${kk}: ${vv}`).join(", ") : String(x)))
        .join(" | ");
    } else if (v && typeof v === "object") flatten(v as Record<string, unknown>, key, out);
    else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) out[key] = eat(new Date(v));
    else if (typeof v === "string" && v !== "" && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) && v.length < 16) out[key] = Number(v);
    else out[key] = v;
  }
  return out;
}

function addSheet(wb: ExcelJS.Workbook, sheet: ExportSheet, used: Set<string>) {
  // Excel: 31 characters, no []:*?/\ and every name different.
  let name = sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31).trim() || "Sheet";
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${sheet.name.slice(0, 27)} (${i})`;
  used.add(name.toLowerCase());

  const rows = sheet.rows.map((r) => flatten(r));
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), keys.push(k));

  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  if (keys.length === 0) {
    ws.addRow(["Nothing was filed in these dates."]);
    return;
  }
  ws.columns = keys.map((k) => ({ header: heading(k), key: k }));
  for (const r of rows) ws.addRow(r);

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E9E4" } };
  ws.columns.forEach((col, i) => {
    const k = keys[i];
    let width = heading(k).length;
    let numeric = rows.length > 0;
    for (const r of rows) {
      const v = r[k];
      if (v !== null && v !== undefined && v !== "" && typeof v !== "number") numeric = false;
      width = Math.max(width, String(v ?? "").length);
    }
    col.width = Math.min(Math.max(width + 2, 8), 60);
    if (numeric) col.numFmt = "#,##0.###";
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
