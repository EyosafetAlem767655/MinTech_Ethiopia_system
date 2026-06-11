import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DamageClaim, type IDamageClaim } from "@/lib/models";

const CLAY = rgb(0.65, 0.24, 0.15);
const INK = rgb(0.17, 0.09, 0.06);
const GRAY = rgb(0.45, 0.42, 0.4);

/**
 * Exportable, timestamped PDF register of verified damage & loss —
 * the auditable evidence pack for the revenue authority.
 */
export async function buildDamageRegisterPdf(): Promise<Uint8Array> {
  const claims = await DamageClaim.find({ status: "verified" })
    .populate<{ lotId: { lotCode: string; supplier: string; bagType: string } }>("lotId", "lotCode supplier bagType")
    .sort({ reviewedAt: 1 })
    .lean();

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 842; // A4 landscape
  const pageH = 595;
  const margin = 40;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const header = () => {
    page.drawRectangle({ x: 0, y: pageH - 26, width: pageW, height: 26, color: CLAY });
    page.drawText("MINTECH ETHIOPIA — DAMAGE & LOSS REGISTER (PB BAGS)", {
      x: margin, y: pageH - 19, size: 11, font: bold, color: rgb(1, 1, 1),
    });
    page.drawText(`Generated: ${stamp}`, { x: pageW - 220, y: pageH - 19, size: 9, font, color: rgb(1, 1, 1) });
    y = pageH - 50;

    const cols = colLayout();
    for (const c of cols) page.drawText(c.title, { x: c.x, y, size: 9, font: bold, color: CLAY });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: CLAY });
    y -= 14;
  };

  const colLayout = () => [
    { title: "DATE", x: margin },
    { title: "LOT / SUPPLIER", x: margin + 70 },
    { title: "BAG TYPE", x: margin + 210 },
    { title: "QTY", x: margin + 300 },
    { title: "PHOTO EVIDENCE REF", x: margin + 340 },
    { title: "AI VERDICT", x: margin + 480 },
    { title: "DISPOSAL", x: margin + 600 },
    { title: "SUPERVISOR SIGN-OFF", x: margin + 690 },
  ];

  header();

  const line = (text: string, x: number, size = 8, color = INK, f = font) =>
    page.drawText(text.length > 40 ? text.slice(0, 39) + "…" : text, { x, y, size, font: f, color });

  let totalBags = 0;
  for (const c of claims as unknown as (IDamageClaim & { lotId: { lotCode: string; supplier: string; bagType: string } })[]) {
    if (y < margin + 30) {
      page = doc.addPage([pageW, pageH]);
      header();
    }
    const cols = colLayout();
    const date = c.reviewedAt ? new Date(c.reviewedAt).toISOString().slice(0, 10) : "—";
    const ai = c.photos?.[0]?.ai;
    const verdict = ai
      ? `${ai.damage_severity}${ai.suspicious ? " ⚠" : ""}`
      : "manual";
    const disposal = c.disposal?.action
      ? c.disposal.action.replace(/_/g, " ") + (c.disposal.amount ? ` (ETB ${c.disposal.amount})` : "")
      : "pending";
    const photoRefs = (c.photos || []).map((p) => String(p.fileId).slice(-8)).join(", ");

    line(date, cols[0].x);
    line(`${c.lotId?.lotCode || "?"} / ${c.lotId?.supplier || "?"}`, cols[1].x);
    line(c.lotId?.bagType || "—", cols[2].x);
    line(String(c.quantity), cols[3].x, 8, INK, bold);
    line(photoRefs || "—", cols[4].x, 7, GRAY);
    line(verdict, cols[5].x);
    line(disposal, cols[6].x);
    line(c.cosignedBy || c.reviewedBy || "—", cols[7].x);
    totalBags += c.quantity;
    y -= 15;
  }

  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: CLAY });
  y -= 16;
  page.drawText(`TOTAL VERIFIED DAMAGED BAGS: ${totalBags}   ·   RECORDS: ${claims.length}`, {
    x: margin, y, size: 10, font: bold, color: INK,
  });
  y -= 14;
  page.drawText(
    `Photo evidence is stored in the MinTech system and retrievable by reference id at ${process.env.APP_URL || ""}/api/files/<id>.`,
    { x: margin, y, size: 8, font, color: GRAY }
  );

  return doc.save();
}
