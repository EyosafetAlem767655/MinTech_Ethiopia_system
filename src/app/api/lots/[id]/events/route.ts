import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";

export const dynamic = "force-dynamic";

/** Record fills / physical stock counts / adjustments against a lot. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "lot not found" }, { status: 404 });

  const body = await req.json();
  const type = body.type;
  if (!["filled", "stock_count", "adjustment"].includes(type) || body.quantity == null) {
    return NextResponse.json({ error: "type and quantity are required" }, { status: 400 });
  }

  const lot = first(await sql<{ id: string }[]>`select id from bag_lots where id = ${params.id}`);
  if (!lot) return NextResponse.json({ error: "lot not found" }, { status: 404 });

  const by = String(body.by || "");
  await sql`
    insert into bag_events (lot_id, type, quantity, by_user, shift, note)
    values (${lot.id}, ${type}, ${Number(body.quantity)}, ${by || null}, ${body.shift ?? null}, ${body.note ?? null})
  `;

  // Record the handler if new. array_append + distinct keeps it idempotent.
  if (by) {
    await sql`
      update bag_lots
         set handlers = (select array(select distinct unnest(handlers || array[${by}])))
       where id = ${lot.id}
    `;
  }

  // No recompute step — v_lot_balances derives the balance on read.
  return NextResponse.json({ ok: true });
}
