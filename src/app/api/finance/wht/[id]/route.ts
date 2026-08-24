import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { logActivity } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";

const ACTIONS = { received: "received", cancel: "cancelled", reopen: "pending" } as const;
type Action = keyof typeof ACTIONS;

const isAction = (v: unknown): v is Action =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(ACTIONS, v);

/**
 * PATCH — close or reopen a WHT chase.
 *
 * Marking the receipt received is what stops the daily SMS. Nothing deletes the
 * `wht_sms_log` rows: they are the record of how often a customer was contacted,
 * which is exactly what someone asks about when a chase goes wrong.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isAction(body.action)) {
    return NextResponse.json(
      { error: `action must be one of: ${Object.keys(ACTIONS).join(", ")}` },
      { status: 400 }
    );
  }
  const status = ACTIONS[body.action];
  const by = typeof body.by === "string" && body.by.trim() ? body.by.trim() : "Dashboard";
  const closing = status !== "pending";

  const row = first(await sql<{ company: string; status: string }[]>`
    update wht_holders
       set status = ${status},
           resolved_by = ${closing ? by : null},
           resolved_at = ${closing ? new Date() : null},
           updated_at = now()
     where id = ${params.id}
     returning company, status
  `);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  await logActivity({
    chatId: "web",
    actor: by,
    audience: "internal",
    action: "report_decided",
    detail: `WHT holder ${row.company} → ${row.status}`,
    ok: true,
  });

  return NextResponse.json({ ok: true, status: row.status });
}
