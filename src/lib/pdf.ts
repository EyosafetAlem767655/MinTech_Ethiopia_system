import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sql from "@/lib/sql";

const CLAY = rgb(0.65, 0.24, 0.15);
const INK = rgb(0.17, 0.09, 0.06);
const GRAY = rgb(0.45, 0.42, 0.4);

interface RegisterRow {
  quantity: number;
  reviewed_at: Date | null;
  cosigned_by: string | null;
  reviewed_by: string | null;
  disposal_action: string | null;
  disposal_amount: string | null;
  lot_code: string | null;
  supplier: string | null;
  bag_type: string | null;
  photo_file_ids: string[];
  ai_severity: string | null;
  ai_suspicious: boolean | null;
}

/**
 * Exportable, timestamped PDF register of verified damage & loss —
 * the auditable evidence pack for the revenue authority.
 */
export async function buildDamageRegisterPdf(): Promise<Uint8Array> {
  const claims = await sql<RegisterRow[]>`
    select c.quantity, c.reviewed_at, c.cosigned_by, c.reviewed_by,
           c.disposal_action, c.disposal_amount,
           l.lot_code, l.supplier, l.bag_type,
           coalesce((
             select array_agg(p.file_id::text order by p.created_at)
               from claim_photos p where p.claim_id = c.id
           ), '{}') as photo_file_ids,
           (select p.ai ->> 'damage_severity' from claim_photos p
             where p.claim_id = c.id order by p.created_at limit 1) as ai_severity,
           (select (p.ai ->> 'suspicious')::boolean from claim_photos p
             where p.claim_id = c.id order by p.created_at limit 1) as ai_suspicious
      from damage_claims c
      left join bag_lots l on l.id = c.lot_id
     where c.status = 'verified'
     order by c.reviewed_at asc
  `;

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 842; // A4 landscape
  const pageH = 595;
  const margin = 40;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

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

  const header = () => {
    page.drawRectangle({ x: 0, y: pageH - 26, width: pageW, height: 26, color: CLAY });
    page.drawText("MINTECH ETHIOPIA — DAMAGE & LOSS REGISTER (PB BAGS)", {
      x: margin, y: pageH - 19, size: 11, font: bold, color: rgb(1, 1, 1),
    });
    page.drawText(`Generated: ${stamp}`, { x: pageW - 220, y: pageH - 19, size: 9, font, color: rgb(1, 1, 1) });
    y = pageH - 50;

    for (const c of colLayout()) page.drawText(c.title, { x: c.x, y, size: 9, font: bold, color: CLAY });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: CLAY });
    y -= 14;
  };

  header();

  const line = (text: string, x: number, size = 8, color = INK, f = font) =>
    page.drawText(text.length > 40 ? text.slice(0, 39) + "…" : text, { x, y, size, font: f, color });

  let totalBags = 0;
  for (const c of claims) {
    if (y < margin + 30) {
      page = doc.addPage([pageW, pageH]);
      header();
    }
    const cols = colLayout();
    const date = c.reviewed_at ? new Date(c.reviewed_at).toISOString().slice(0, 10) : "—";
    const verdict = c.ai_severity ? `${c.ai_severity}${c.ai_suspicious ? " ⚠" : ""}` : "manual";
    const disposal = c.disposal_action
      ? c.disposal_action.replace(/_/g, " ") +
        (c.disposal_amount ? ` (ETB ${Number(c.disposal_amount)})` : "")
      : "pending";
    const photoRefs = (c.photo_file_ids || []).map((id) => String(id).slice(-8)).join(", ");

    line(date, cols[0].x);
    line(`${c.lot_code || "?"} / ${c.supplier || "?"}`, cols[1].x);
    line(c.bag_type || "—", cols[2].x);
    line(String(c.quantity), cols[3].x, 8, INK, bold);
    line(photoRefs || "—", cols[4].x, 7, GRAY);
    line(verdict, cols[5].x);
    line(disposal, cols[6].x);
    line(c.cosigned_by || c.reviewed_by || "—", cols[7].x);
    totalBags += Number(c.quantity);
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
