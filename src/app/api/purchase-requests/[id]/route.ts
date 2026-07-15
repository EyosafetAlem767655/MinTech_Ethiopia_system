import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";

export const dynamic = "force-dynamic";

const VALID_ACTIONS = ["approve", "reject", "bought", "disregarded", "deferred"] as const;
type Action = (typeof VALID_ACTIONS)[number];

const ACTION_TO_STATUS: Record<Action, string> = {
  approve: "approved",
  reject: "rejected",
  bought: "bought",
  disregarded: "disregarded",
  deferred: "deferred",
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  const action = body.action as Action;
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action must be one of: ${VALID_ACTIONS.join(", ")}` }, { status: 400 });
  }

  const pr = first(await sql<{ status: string }[]>`
    update purchase_requests
       set status = ${ACTION_TO_STATUS[action]}, decided_by = ${body.decidedBy || "Mr. Anteneh"}, decided_at = now()
     where id = ${params.id}
     returning status
  `);
  if (!pr) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status: pr.status });
}
