import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import {
  updateWatchlistEntry,
  deleteWatchlistEntry,
  BridgeWatchlistError,
  type WatchlistPatch,
} from "@/lib/watchlist";

// The bridge call goes out over the network; keep it on the Node runtime to
// match the other bridge-backed routes.
export const runtime = "nodejs";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
}

// Map a bridge error to the matching client status (400 validation, 404 unknown
// id); anything else is an upstream reachability problem → 502.
function bridgeErrorResponse(err: unknown): Response {
  if (err instanceof BridgeWatchlistError && err.status === 400) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof BridgeWatchlistError && err.status === 404) {
    return Response.json({ error: "Watchlist entry not found" }, { status: 404 });
  }
  console.error("Watchlist bridge call failed:", err);
  return Response.json(
    { error: "Could not reach the watchlist service" },
    { status: 502 },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: WatchlistPatch;
  try {
    body = (await request.json()) as WatchlistPatch;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const entry = await updateWatchlistEntry(id, body);
    return Response.json({ entry });
  } catch (err) {
    return bridgeErrorResponse(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAuthed())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await deleteWatchlistEntry(id);
    return Response.json({ ok: true, id });
  } catch (err) {
    return bridgeErrorResponse(err);
  }
}
