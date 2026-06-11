import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { BagEvent, BagLot } from "@/lib/models";

export const dynamic = "force-dynamic";

/** Record fills / physical stock counts / adjustments against a lot. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  await dbConnect();
  const body = await req.json();
  const type = body.type;
  if (!["filled", "stock_count", "adjustment"].includes(type) || body.quantity == null) {
    return NextResponse.json({ error: "type and quantity are required" }, { status: 400 });
  }
  const lot = await BagLot.findById(params.id);
  if (!lot) return NextResponse.json({ error: "lot not found" }, { status: 404 });

  await BagEvent.create({
    lotId: lot._id,
    type,
    quantity: Number(body.quantity),
    by: String(body.by || ""),
    shift: body.shift,
    note: body.note,
    date: new Date(),
  });
  if (body.by && !lot.handlers.includes(body.by)) {
    lot.handlers.push(String(body.by));
    await lot.save();
  }
  return NextResponse.json({ ok: true });
}
