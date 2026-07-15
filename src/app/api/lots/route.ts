import { NextRequest, NextResponse } from "next/server";
import sql from "@/lib/sql";
import { putFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Lots with their derived balance (from v_lot_balances) nested back in, so the
// bags page keeps reading `lot.balance.gap` etc. without any change.
export async function GET() {
  const lots = await sql`
    select l.id as _id, l.lot_code as "lotCode", l.supplier, l.bag_type as "bagType",
           l.quantity, l.delivery_note as "deliveryNote", l.handlers,
           l.received_at as "receivedAt",
           jsonb_build_object(
             'received', b.received, 'filled', b.filled,
             'damagedVerified', b.damaged_verified, 'damagedPending', b.damaged_pending,
             'disposed', b.disposed, 'inStock', b.in_stock, 'gap', b.gap
           ) as balance
      from bag_lots l
      join v_lot_balances b on b.lot_id = l.id
     order by l.received_at desc
  `;
  return NextResponse.json(lots);
}

/** Supervisor registers a bag lot: supplier, quantity, bag type, photos, delivery note. */
export async function POST(req: NextRequest) {
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

  const photoIds: string[] = [];
  for (const entry of form.getAll("photos")) {
    const file = entry as File;
    if (!file || file.size === 0) continue;
    const stored = await putFile(Buffer.from(await file.arrayBuffer()), file.type || "image/jpeg", {
      kind: "lot_photo",
      filename: file.name,
    });
    photoIds.push(stored.id);
  }

  // lot_code from a sequence — the DB guarantees uniqueness, no count()+1 race.
  const [lot] = await sql<{ id: string; lot_code: string }[]>`
    insert into bag_lots (lot_code, supplier, bag_type, quantity, delivery_note, registered_by, handlers, photo_ids)
    values (
      'LOT-' || extract(year from now())::int || '-' || lpad(nextval('bag_lot_code_seq')::text, 4, '0'),
      ${supplier}, ${bagType}, ${quantity}, ${deliveryNote}, ${registeredBy || null},
      ${registeredBy ? [registeredBy] : []}, ${photoIds}
    )
    returning id, lot_code
  `;

  return NextResponse.json({ ok: true, id: lot.id, lotCode: lot.lot_code });
}
