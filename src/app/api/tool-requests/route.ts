import { NextResponse } from "next/server";
import sql from "@/lib/sql";
import { displayDepartment } from "@/lib/purchase-departments";
import { similarItem } from "@/lib/purchase-history";

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
    // With the machine it is for (0043).
    () => sql<Record<string, unknown>[]>`
      select id as _id, title, quantity, kind, justification, amount,
             description, unit, department, notes, machine,
             coalesce(photo_file_id::text, tg_file_id) as "photoFileId", legitimacy, status,
             decided_by as "decidedBy", decided_at as "decidedAt",
             requested_by as "requestedBy", created_at as "createdAt"
        from purchase_requests
       order by created_at desc
       limit 500
    `,
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

  // What the Goods Receiving Vouchers received, to show an approved request as
  // Purchased once its item came in. Matched by name (similarItem), because
  // a GRV has no request number to link it by.
  const received = await sql<{ description: string; grv_no: string | null; date: Date }[]>`
    select i.description, v.grv_no, v.date
      from goods_receiving_items i
      join goods_receiving_vouchers v on v.id = i.grv_id
     where i.description is not null
     order by v.date asc
  `.catch(() => []);

  return NextResponse.json(
    rows.map((r) => {
      const status = String(r.status || "");
      const created = new Date(String(r.createdAt)).getTime();
      // The voucher must be no older than a day before the request: an item
      // bought last year is not this request's purchase.
      // Any request still open, approved or bought: a GRV that received the item
      // executes it, whether or not anyone pressed a button.
      const line =
        ["pending", "deferred", "approved", "bought"].includes(status)
          ? received.find(
              (g) => new Date(g.date).getTime() >= created - 86_400_000 && similarItem(String(r.title || ""), g.description)
            )
          : undefined;
      return {
        ...r,
        // Shown, not stored: machine parts asked for by production read as Technical.
        departmentFiled: r.department ?? null,
        department: displayDepartment(r.department as string | null, r.title as string | null),
        purchased: line ? { grvNo: line.grv_no, date: line.date, line: line.description } : null,
        // "Executed" is the owner's word for an approved request, for one marked
        // bought, and for one a GRV received. The stored status is unchanged.
        displayStatus: line || status === "bought" || status === "approved" ? "executed" : status,
        quantity: r.quantity == null ? null : Number(r.quantity),
        amount: r.amount == null ? null : Number(r.amount),
      };
    })
  );
}
