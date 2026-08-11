import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";
import { createSession, deviceLabel, generateSessionToken } from "@/lib/websession";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = generateSessionToken();
  const ua = req.headers.get("user-agent") || "";
  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";

  try {
    await createSession({ token, label: deviceLabel(ua), userAgent: ua.slice(0, 300), ip });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create the session." },
      { status: 500 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  return res;
}
