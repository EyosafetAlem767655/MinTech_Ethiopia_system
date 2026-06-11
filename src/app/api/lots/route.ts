import { NextRequest, NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { BagLot, StoredFile } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  await dbConnect();
  const lots = await BagLot.find().sort({ receivedAt: -1 }).lean();
  return NextResponse.json(lots);
}

/** Supervisor registers a bag lot: supplier, quantity, bag type, photos, delivery note. */
export async function POST(req: NextRequest) {
  await dbConnect();
  const form = await req.formData();
  const supplier = String(form.get("supplier") || "");
  const bagType = String(form.get("bagType") || "");
  const quantity = Number(form.get("quantity"));
  const deliveryNote = String(form.get("deliveryNote") || "");
  const registeredBy = String(form.get("registeredBy") || "");
  if (!supplier || !bagType || !quantity || !deliveryNote) {
    return NextResponse.json(
      { error: "supplier, bagType, quantity and deliveryNote are required" },
      { status: 400 }
    );
  }

  const photoIds = [];
  for (const entry of form.getAll("photos")) {
    const file = entry as File;
    if (!file || file.size === 0) continue;
    const stored = await StoredFile.create({
      data: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || "image/jpeg",
      filename: file.name,
      kind: "lot_photo",
    });
    photoIds.push(stored._id);
  }

  const count = await BagLot.countDocuments();
  const lot = await BagLot.create({
    lotCode: `LOT-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`,
    supplier,
    bagType,
    quantity,
    deliveryNote,
    photoIds,
    registeredBy,
    handlers: registeredBy ? [registeredBy] : [],
    receivedAt: new Date(),
    balance: {
      received: quantity,
      filled: 0,
      damagedVerified: 0,
      damagedPending: 0,
      disposed: 0,
      inStock: quantity,
      gap: 0,
      computedAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true, id: lot._id, lotCode: lot.lotCode });
}
