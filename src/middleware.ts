import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isAuthDisabled, readSession } from "@/lib/auth";
import { isSessionRevoked } from "@/lib/websession";
import { roleDenies } from "@/lib/roles";

// Routes reachable without the dashboard password.
// Keep these as specific as possible: a bare "/api/telegram" prefix would also
// expose any future "/api/telegram-*" route (e.g. user management).
const PUBLIC_PREFIXES = [
  "/login",
  "/api/login",
  "/api/telegram/webhook",
  "/api/cron",
  "/manifest.json",
  "/sw.js",
  "/icons",
  "/logo.png",
  "/screenshots",
  "/_next",
  "/favicon",
];

export async function middleware(req: NextRequest) {
  if (isAuthDisabled()) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Authentication: pure-crypto signature check, no network. A valid signature
  // means this cookie was minted by a real ADMIN_PASSWORD login.
  const session = await readSession(req.cookies.get(AUTH_COOKIE)?.value);
  if (session) {
    // Authorization: has this specific device been revoked? Fail-open — only a
    // POSITIVE "revoked" answer bounces the user, so a slow or unreachable DB
    // never locks anyone out of the dashboard.
    if (!(await isSessionRevoked(session.sid))) {
      const denied = roleDenies(session.role, req.method, pathname);
      if (!denied) return NextResponse.next();
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: denied }, { status: 403 });
      const home = req.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return NextResponse.redirect(home);
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
