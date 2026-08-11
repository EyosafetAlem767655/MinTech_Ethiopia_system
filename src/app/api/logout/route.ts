import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";
import { revokeByToken } from "@/lib/websession";

export const dynamic = "force-dynamic";

/** Logs the current browser out: revokes its session row and clears the cookie. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (token) await revokeByToken(token).catch(() => {});
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
