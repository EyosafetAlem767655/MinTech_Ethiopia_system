import { NextRequest, NextResponse } from "next/server";
import sql, { isUuid } from "@/lib/sql";
import { listErrors } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** GET — what has been failing, newest first. `?all=1` includes resolved rows. */
export async function GET(req: NextRequest) {
  const includeResolved = req.nextUrl.searchParams.get("all") === "1";
  try {
    return NextResponse.json({ rows: await listErrors({ includeResolved }) });
  } catch (e) {
    // The table arrives in 0021. An empty list beats a 500 on the one screen
    // whose job is to show that something is wrong.
    if ((e as { code?: string })?.code === "42P01") {
      return NextResponse.json({ rows: [], unavailable: true });
    }
    throw e;
  }
}

/**
 * PATCH { id } — mark one dealt with.
 *
 * Resolving hides the row but keeps it: the 24-hour count beside each error is
 * what distinguishes a one-off from something happening every few minutes, and
 * deleting the history would remove exactly that signal.
 */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id || "");
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const by = typeof body.by === "string" && body.by.trim() ? body.by.trim() : "Dashboard";
  const rows = await sql<{ id: string }[]>`
    update system_errors set resolved_at = now(), resolved_by = ${by}
     where id = ${id} and resolved_at is null
     returning id
  `;
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
