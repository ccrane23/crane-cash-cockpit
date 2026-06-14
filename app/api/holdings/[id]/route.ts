import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { deleteHolding, BridgeHoldingsError } from "@/lib/holdings";

// The bridge call goes out over the network; keep it on the Node runtime to
// match the other bridge-backed routes.
export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Defense in depth: re-verify the session here, not just in proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteHolding(id);
    return Response.json({ ok: true, id });
  } catch (err) {
    // Relay the bridge's 404 so the client knows the lot was already gone.
    if (err instanceof BridgeHoldingsError && err.status === 404) {
      return Response.json({ error: "Holding not found" }, { status: 404 });
    }
    console.error("Failed to delete holding via bridge:", err);
    return Response.json(
      { error: "Could not reach the holdings service" },
      { status: 502 },
    );
  }
}
