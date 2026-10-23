import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isAuthDisabled, readSession } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { sessionUserName } from "@/lib/web-users";

export const dynamic = "force-dynamic";

/** GET — who is signed in: their role, and the name to greet them by. */
export async function GET(req: NextRequest) {
  const session = isAuthDisabled()
    ? { sid: "", role: "super" as const }
    : await readSession(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const name =
    session.role === "super" ? "Mr. Anteneh" : (await sessionUserName(session.sid)) ?? ROLE_LABEL[session.role];
  return NextResponse.json({ role: session.role, roleLabel: ROLE_LABEL[session.role], name });
}
