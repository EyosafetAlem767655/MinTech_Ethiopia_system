import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken } from "@/lib/auth";
import { createSession, deviceLabel, generateSessionToken } from "@/lib/websession";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const ua = req.headers.get("user-agent") || "";
  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";

  // Preferred path: a per-device session row so Settings ▸ Devices can list/revoke.
  // Fallback path: if the session store isn't configured or the write fails (e.g.
  // the migration hasn't been applied), we must NOT lock the user out — fall back
  // to the deterministic password-derived token, which the middleware also accepts.
  let cookieValue: string;
  try {
    const token = generateSessionToken();
    await createSession({ token, label: deviceLabel(ua), userAgent: ua.slice(0, 300), ip });
    cookieValue = token;
  } catch (e) {
    console.error("web session create failed, using fallback token:", e);
    cookieValue = await authToken();
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  return res;
}
