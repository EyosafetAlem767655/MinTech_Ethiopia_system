import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken, isAuthDisabled } from "@/lib/auth";
import { isValidSession } from "@/lib/websession";

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

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie) {
    // Accept either a live per-device session token, or the deterministic
    // password-derived token used as a fallback when the session store is
    // unavailable. The latter keeps the dashboard reachable even if the
    // web_sessions migration hasn't run yet.
    if (cookie === (await authToken())) return NextResponse.next();
    if (await isValidSession(cookie)) return NextResponse.next();
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
