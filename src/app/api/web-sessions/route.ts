import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";
import { listSessions, sessionIdForToken } from "@/lib/websession-node";

export const dynamic = "force-dynamic";

/** GET — active devices/sessions, marking the caller's current one. */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value || "";
  const [rows, currentId] = await Promise.all([
    listSessions(),
    token ? sessionIdForToken(token) : Promise.resolve(null),
  ]);
  const sessions = rows.map((r) => ({
    _id: r.id,
    label: r.label,
    userAgent: r.user_agent,
    ip: r.ip,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    current: r.id === currentId,
  }));
  return NextResponse.json({ sessions });
}
