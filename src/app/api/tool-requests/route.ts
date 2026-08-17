import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — tool purchase requests filed from the bot (Asset Management tab). */
export async function GET() {
  // quantity / kind arrive in 0013; fall back to the core columns when a
  // deployment is running ahead of its migrations rather than 500-ing.
  let rows: Record<string, unknown>[];
  try {
    rows = await sql<Record<string, unknown>[]>`
      select id as _id, title, quantity, kind, justification, amount,
             photo_file_id as "photoFileId", legitimacy, status,
             requested_by as "requestedBy", created_at as "createdAt"
        from purchase_requests
       order by created_at desc
       limit 200
    `;
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "42P01") return NextResponse.json([]);
    if (code !== "42703") throw e;
    rows = await sql<Record<string, unknown>[]>`
      select id as _id, title, justification, amount,
             photo_file_id as "photoFileId", legitimacy, status,
             requested_by as "requestedBy", created_at as "createdAt"
        from purchase_requests
       order by created_at desc
       limit 200
    `;
  }

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      quantity: r.quantity == null ? null : Number(r.quantity),
      amount: r.amount == null ? null : Number(r.amount),
    }))
  );
}
