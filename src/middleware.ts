import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, authToken, isAuthDisabled } from "@/lib/auth";

// Routes reachable without the dashboard password.
const PUBLIC_PREFIXES = [
  "/login",
  "/api/login",
  "/api/telegram",
  "/api/cron",
  "/manifest.json",
  "/sw.js",
  "/icons",
  "/_next",
  "/favicon",
];

export async function middleware(req: NextRequest) {
  if (isAuthDisabled()) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie === (await authToken())) return NextResponse.next();

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
