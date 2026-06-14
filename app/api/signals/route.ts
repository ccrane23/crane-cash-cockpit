import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getSignals } from "@/lib/signals";

// The bridge call goes out over the network (and may compute on a cold cache);
// keep it on the Node runtime to match the other bridge-backed routes.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Defense in depth: re-verify the session here, not just in proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "true";

  try {
    return Response.json(await getSignals({ force }));
  } catch (err) {
    console.error("Failed to load signals from bridge:", err);
    return Response.json(
      { error: "Could not reach the signals service" },
      { status: 502 },
    );
  }
}
