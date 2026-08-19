import { NextRequest, NextResponse } from "next/server";
import sql, { first, isUuid } from "@/lib/sql";
import { logActivity } from "@/lib/bot-auth";

export const dynamic = "force-dynamic";

const ACTIONS = { approve: "approved", reject: "rejected", reopen: "pending" } as const;
type Action = keyof typeof ACTIONS;

const isAction = (v: unknown): v is Action =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(ACTIONS, v);

/**
 * PATCH — accept or refuse a PP bag damage report.
 *
 * The AI trust score is advice. A person makes the call: a report the model could
 * not check at all is still approvable, and a convincing photo is still
 * refusable. `reopen` exists because a decision made on a misread photo should be
 * correctable without deleting the employee's report.
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
  const by = typeof body.decidedBy === "string" && body.decidedBy.trim() ? body.decidedBy.trim() : "Dashboard";

  try {
    const row = first(await sql<{ status: string; reported_by: string }[]>`
      update pp_bag_damage_reports
         set status = ${status},
             decided_by = ${status === "pending" ? null : by},
             decided_at = ${status === "pending" ? null : new Date()},
             updated_at = now()
       where id = ${params.id}
       returning status, reported_by
    `);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

    await logActivity({
      chatId: "web",
      actor: by,
      audience: "internal",
      action: "report_decided",
      detail: `PP bag damage ${params.id} → ${status} (filed by ${row.reported_by})`,
      ok: true,
    });

    return NextResponse.json({ ok: true, status: row.status });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // 42703: the review columns arrive in 0015. Say which migration is missing
    // rather than letting the button fail with a bare 500.
    if (code === "42P01" || code === "42703") {
      return NextResponse.json(
        { error: "Review columns are missing — apply migration 0015_pp_bag_damage_review.sql." },
        { status: 503 }
      );
    }
    throw e;
  }
}
