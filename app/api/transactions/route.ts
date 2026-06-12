import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getTransactions } from "@/lib/actual";

// The bridge call goes out over the network; keep it on the Node runtime to
// match the accounts route and avoid the edge fetch quirks.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Defense in depth: re-verify the session here, not just in proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = request.nextUrl.searchParams.get("start") ?? undefined;
  const end = request.nextUrl.searchParams.get("end") ?? undefined;

  try {
    const transactions = await getTransactions({ start, end });
    return Response.json({ transactions });
  } catch (err) {
    console.error("Failed to load transactions from Actual:", err);
    return Response.json(
      { error: "Could not reach the Actual budget server" },
      { status: 502 },
    );
  }
}
