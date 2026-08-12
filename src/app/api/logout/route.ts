import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, verifySession } from "@/lib/auth";
import { revokeSession } from "@/lib/websession-node";

export const dynamic = "force-dynamic";

/** Logs the current browser out: revokes its session row and clears the cookie. */
export async function POST(req: NextRequest) {
  const sid = await verifySession(req.cookies.get(AUTH_COOKIE)?.value);
  if (sid) await revokeSession(sid).catch(() => {});
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
