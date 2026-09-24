import { NextResponse } from "next/server";
import sql from "@/lib/sql";

export const dynamic = "force-dynamic";

/** GET — tool purchase requests filed from the bot (Asset Management tab). */
export async function GET() {
  // quantity / kind arrive in 0013, tg_file_id in 0025 and the four new-tool
  // columns in 0028. Three shapes, newest first: a deployment running ahead of
  // its migrations loses the newest columns rather than 500-ing. Each fallback
  // costs a detail — a thumbnail, a description — never the request.
  //
  // 500 rather than 200 because the panel now answers "have we bought this
  // before?" from these rows. A window that stops short of the last purchase of
  // a part would answer that question with a confident no.
  const shapes = [
    () => sql<Record<string, unknown>[]>`
      select id as _id, title, quantity, kind, justification, amount,
             description, unit, department, notes,
             coalesce(photo_file_id::text, tg_file_id) as "photoFileId", legitimacy, status,
             decided_by as "decidedBy", decided_at as "decidedAt",
             requested_by as "requestedBy", created_at as "createdAt"
        from purchase_requests
       order by created_at desc
       limit 500
    `,
    () => sql<Record<string, unknown>[]>`
      select id as _id, title, quantity, kind, justification, amount,
             coalesce(photo_file_id::text, tg_file_id) as "photoFileId", legitimacy, status,
             decided_by as "decidedBy", decided_at as "decidedAt",
             requested_by as "requestedBy", created_at as "createdAt"
        from purchase_requests
       order by created_at desc
       limit 500
    `,
    () => sql<Record<string, unknown>[]>`
      select id as _id, title, justification, amount,
             photo_file_id as "photoFileId", legitimacy, status,
             decided_by as "decidedBy", decided_at as "decidedAt",
             requested_by as "requestedBy", created_at as "createdAt"
        from purchase_requests
       order by created_at desc
       limit 500
    `,
  ];

  let rows: Record<string, unknown>[] = [];
  for (let i = 0; i < shapes.length; i++) {
    try {
      rows = await shapes[i]();
      break;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === "42P01") return NextResponse.json([]);
      if (code !== "42703" || i === shapes.length - 1) throw e;
    }
  }

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      quantity: r.quantity == null ? null : Number(r.quantity),
      amount: r.amount == null ? null : Number(r.amount),
    }))
  );
}
