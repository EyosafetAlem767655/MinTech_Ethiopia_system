import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { AUTH_COOKIE, signSession } from "@/lib/auth";
import { deviceLabel } from "@/lib/websession";
import { createSession } from "@/lib/websession-node";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const ua = req.headers.get("user-agent") || "";
  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";

  // Preferred path: record a per-device row so Settings ▸ Devices can list/revoke,
  // and sign that row's id into the cookie. Fallback: if the DB write fails, sign
  // a throwaway id so login STILL succeeds — the signature is what authenticates,
  // the row is only for device management. Either way the cookie is valid.
  let sid: string;
  try {
    sid = await createSession({ label: deviceLabel(ua), userAgent: ua.slice(0, 300), ip });
  } catch (e) {
    console.error("web session create failed, signing throwaway id:", e);
    sid = randomUUID();
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await signSession(sid), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  return res;
}
