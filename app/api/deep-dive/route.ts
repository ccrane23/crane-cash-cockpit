import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getDeepDive } from "@/lib/deepdive";

// Calls the bridge, which calls Anthropic — keep it on the Node runtime and never
// cache (the bridge owns the 24h thesis cache).
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Defense in depth: re-verify the session here, not just in proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { ticker?: string };
  try {
    body = (await request.json()) as { ticker?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.ticker || typeof body.ticker !== "string") {
    return Response.json({ error: "ticker is required" }, { status: 400 });
  }

  try {
    return Response.json(await getDeepDive(body.ticker));
  } catch (err) {
    // The bridge already maps failures (missing key, Anthropic error) to a clear
    // message; surface a stable one to the UI either way.
    console.error("Failed to generate deep dive via bridge:", err);
    return Response.json({ error: "Deep dive unavailable" }, { status: 502 });
  }
}
