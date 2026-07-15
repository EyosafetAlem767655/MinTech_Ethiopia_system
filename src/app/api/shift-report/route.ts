import { NextRequest, NextResponse } from "next/server";
import sql, { isUuid } from "@/lib/sql";

export const dynamic = "force-dynamic";

/** The 60-second end-of-shift form: filled sacks, downtime, notes. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.supervisor || body.filledSacks == null) {
    return NextResponse.json({ error: "supervisor and filledSacks are required" }, { status: 400 });
  }
  const bagWeightKg = [25, 40].includes(Number(body.bagWeightKg)) ? Number(body.bagWeightKg) : null;
  const shift = body.shift === "night" ? "night" : "day";
  const lotId = body.lotId && isUuid(String(body.lotId)) ? String(body.lotId) : null;

  const [report] = await sql<{ id: string }[]>`
    insert into shift_reports (supervisor, filled_sacks, bag_weight_kg, downtime_minutes, shift, notes, lot_id)
    values (${String(body.supervisor)}, ${Number(body.filledSacks)}, ${bagWeightKg},
            ${Number(body.downtimeMinutes) || 0}, ${shift}, ${body.notes ? String(body.notes) : null}, ${lotId})
    returning id
  `;

  // Filling sacks consumes bags from the lot — feeds the derived lot balance.
  if (lotId && Number(body.filledSacks) > 0) {
    await sql`
      insert into bag_events (lot_id, type, quantity, by_user, shift, note)
      values (${lotId}, 'filled', ${Number(body.filledSacks)}, ${String(body.supervisor)}, ${shift}, 'end-of-shift form')
    `;
  }
  return NextResponse.json({ ok: true, id: report.id });
}

export async function GET() {
  const reports = await sql`
    select id as _id, date, shift, supervisor, filled_sacks as "filledSacks",
           bag_weight_kg as "bagWeightKg", downtime_minutes as "downtimeMinutes", notes, lot_id as "lotId"
      from shift_reports
     order by date desc
     limit 30
  `;
  return NextResponse.json(reports);
}
