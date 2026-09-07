import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/**
 * GET — daily PP bag consumption, one entry per day with its lines.
 *
 * The lines come back nested rather than as a flat join, because a day is the
 * unit the report is filed in and the unit it is corrected in: re-filing a day
 * replaces its lines. Flattening here would let the panel show half of a
 * replaced day beside half of its replacement.
 */
export async function GET() {
  try {
    const rows = await sql<Record<string, unknown>[]>`
      select u.id as _id, u.date, u.date_label as "dateLabel",
             u.reported_by as "reportedBy", u.created_at as "createdAt",
             coalesce(
               (select jsonb_agg(jsonb_build_object(
                   'ledgerKey', i.ledger_key,
                   'referenceNo', i.reference_no,
                   'quantity', i.quantity
                 ) order by i.position)
                  from pp_bag_usage_items i where i.usage_id = u.id),
               '[]'::jsonb
             ) as items
        from pp_bag_usage u
       order by u.date desc, u.created_at desc
       limit 120
    `;

    return NextResponse.json(
      rows.map((r) => ({
        ...r,
        items: ((r.items as { ledgerKey: string; referenceNo: string | null; quantity: string }[]) || []).map(
          (it) => ({ ...it, quantity: Number(it.quantity) || 0 })
        ),
      }))
    );
  } catch (e) {
    // The tables arrive in 0022 — an empty panel, never a 500.
    if ((e as { code?: string })?.code === "42P01") return NextResponse.json([]);
    throw e;
  }
}
