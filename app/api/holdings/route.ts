import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import {
  getHoldings,
  addHolding,
  BridgeHoldingsError,
  type NewLotInput,
} from "@/lib/holdings";

// The bridge call goes out over the network; keep it on the Node runtime to
// match the other bridge-backed routes.
export const runtime = "nodejs";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

export async function GET() {
  // Defense in depth: re-verify the session here, not just in proxy.ts.
  if (!(await isAuthed())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return Response.json(await getHoldings());
  } catch (err) {
    console.error("Failed to load holdings from bridge:", err);
    return Response.json(
      { error: "Could not reach the holdings service" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: NewLotInput;
  try {
    body = (await request.json()) as NewLotInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const lot = await addHolding(body);
    return Response.json({ lot }, { status: 201 });
  } catch (err) {
    // Relay the bridge's validation message verbatim so the form can show it.
    if (err instanceof BridgeHoldingsError && err.status === 400) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Failed to add holding via bridge:", err);
    return Response.json(
      { error: "Could not reach the holdings service" },
      { status: 502 },
    );
  }
}
