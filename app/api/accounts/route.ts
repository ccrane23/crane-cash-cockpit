import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getAccounts } from "@/lib/actual";

// The SDK touches the filesystem and native modules — force Node runtime.
export const runtime = "nodejs";

export async function GET() {
  // Defense in depth: re-verify the session here, not just in proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accounts = await getAccounts();
    return Response.json({ accounts });
  } catch (err) {
    console.error("Failed to load accounts from Actual:", err);
    return Response.json(
      { error: "Could not reach the Actual budget server" },
      { status: 502 },
    );
  }
}
