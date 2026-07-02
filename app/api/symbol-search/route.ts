import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { searchSymbols } from "@/lib/symbolSearch";

// The bridge call goes out over the network; keep it on the Node runtime to
// match the other bridge-backed routes.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Defense in depth: re-verify the session here, not just in proxy.ts. The
  // autocomplete fires on every keystroke, so an unauthenticated caller must not
  // be able to burn Finnhub quota through this proxy.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";

  try {
    return Response.json({ results: await searchSymbols(q) });
  } catch (err) {
    console.error("Failed to search symbols via bridge:", err);
    // Degrade to an empty list rather than erroring — the autocomplete just
    // shows "no matches" and the user can still type the ticker manually.
    return Response.json({ results: [] });
  }
}
