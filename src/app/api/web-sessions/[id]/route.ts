import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/sql";
import { revokeSession } from "@/lib/websession-node";

export const dynamic = "force-dynamic";

/** DELETE — revoke a device/session; that browser is bounced to /login next request. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await revokeSession(params.id);
  return NextResponse.json({ ok: true });
}
