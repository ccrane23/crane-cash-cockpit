import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// In Next.js 16 the middleware convention was renamed to `proxy`. This runs
// before routes render and redirects unauthenticated traffic to /login.
// Note: this is a convenience gate only — /api/accounts re-verifies the session
// itself, since proxy is not an authorization boundary.

export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionToken(token)) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Gate pages only. API routes are excluded — they self-authorize and return
  // proper JSON status codes (e.g. 401) instead of an HTML redirect, which a
  // client-side fetch can handle. Also skip the login page and static assets.
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
