import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { AUTH_COOKIE, signSession } from "@/lib/auth";
import { deviceLabel } from "@/lib/websession";
import { createSession } from "@/lib/websession-node";
import { checkWebLogin } from "@/lib/web-users";
import type { Role } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Two ways in:
 *   - the password alone, matching ADMIN_PASSWORD → the Super Admin;
 *   - a name and that person's password (0045) → their account's role.
 */
export async function POST(req: NextRequest) {
  const { name, password } = await req.json().catch(() => ({}));
  const typedName = String(name || "").trim();

  let role: Role;
  let userId: string | undefined;
  if (!typedName) {
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }
    role = "super";
  } else {
    const user = await checkWebLogin(typedName, String(password || "")).catch((e) => {
      console.error("web login failed:", e);
      return null;
    });
    if (!user) return NextResponse.json({ error: "Wrong name or password" }, { status: 401 });
    role = user.role;
    userId = user.id;
  }

  const ua = req.headers.get("user-agent") || "";
  const ip =
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";

  // Preferred path: record a per-device row so Settings ▸ Devices can list/revoke,
  // and sign that row's id into the cookie. Fallback (Super Admin only): if the
  // DB write fails, sign a throwaway id so login STILL succeeds. A personal
  // account must have its row — it is what revoking the account cuts off.
  let sid: string;
  try {
    sid = await createSession({ label: deviceLabel(ua), userAgent: ua.slice(0, 300), ip, userId, role });
  } catch (e) {
    console.error("web session create failed:", e);
    if (userId) return NextResponse.json({ error: "Could not sign in. Please try again." }, { status: 503 });
    sid = randomUUID();
  }

  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(AUTH_COOKIE, await signSession(sid, role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  return res;
}
