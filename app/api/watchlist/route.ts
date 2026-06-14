import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import {
  getWatchlist,
  addWatchlistEntry,
  BridgeWatchlistError,
  type NewWatchlistInput,
} from "@/lib/watchlist";

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
    return Response.json(await getWatchlist());
  } catch (err) {
    console.error("Failed to load watchlist from bridge:", err);
    return Response.json(
      { error: "Could not reach the watchlist service" },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: NewWatchlistInput;
  try {
    body = (await request.json()) as NewWatchlistInput;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const entry = await addWatchlistEntry(body);
    return Response.json({ entry }, { status: 201 });
  } catch (err) {
    if (err instanceof BridgeWatchlistError && err.status === 400) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error("Failed to add watchlist entry via bridge:", err);
    return Response.json(
      { error: "Could not reach the watchlist service" },
      { status: 502 },
    );
  }
}
