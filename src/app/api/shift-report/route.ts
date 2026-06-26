import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { BagEvent, ShiftReport } from "@/lib/models";
import { recomputeLotBalances } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/** The 60-second end-of-shift form: filled sacks, downtime, notes. */
export async function POST(req: NextRequest) {
  await dbConnect();
  const body = await req.json();
  if (!body.supervisor || body.filledSacks == null) {
    return NextResponse.json({ error: "supervisor and filledSacks are required" }, { status: 400 });
  }
  const bagWeightKg = [25, 40].includes(Number(body.bagWeightKg)) ? Number(body.bagWeightKg) : undefined;
  const report = await ShiftReport.create({
    supervisor: String(body.supervisor),
    filledSacks: Number(body.filledSacks),
    bagWeightKg,
    downtimeMinutes: Number(body.downtimeMinutes) || 0,
    shift: body.shift === "night" ? "night" : "day",
    notes: body.notes ? String(body.notes) : undefined,
    lotId: body.lotId || undefined,
    date: new Date(),
  });
  // Filling sacks consumes bags from the lot — feeds the lot balance.
  if (body.lotId && Number(body.filledSacks) > 0) {
    await BagEvent.create({
      lotId: body.lotId,
      type: "filled",
      quantity: Number(body.filledSacks),
      by: String(body.supervisor),
      shift: report.shift,
      note: "end-of-shift form",
    });
    await recomputeLotBalances();
  }
  return NextResponse.json({ ok: true, id: report._id });
}

export async function GET() {
  await dbConnect();
  const reports = await ShiftReport.find().sort({ date: -1 }).limit(30).lean();
  return NextResponse.json(reports);
}
