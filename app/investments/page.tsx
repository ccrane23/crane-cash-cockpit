import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { describeError } from "@/lib/actual";
import { getHoldings, type HoldingsData } from "@/lib/holdings";
import Nav from "../Nav";
import SignOutButton from "../sign-out-button";
import Investments from "./Investments";

// Personal financial data — never cache, always render per request.
export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  // Defense in depth alongside proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    redirect("/login");
  }

  let holdings: HoldingsData | null = null;
  let error: string | null = null;
  try {
    holdings = await getHoldings();
  } catch (err) {
    console.error("Failed to load holdings:", describeError(err));
    error = "Could not reach the holdings service.";
  }

  return (
    <main className="flex flex-1 flex-col p-6 sm:p-10">
      <header className="flex items-baseline justify-between border-b border-[var(--color-border)] pb-4">
        <div>
          <p className="mini-label">Crane Cash Cockpit</p>
          <h1 className="mt-1 text-xl font-medium text-[var(--color-text)]">
            Investments
          </h1>
        </div>
        <div className="flex items-center gap-5">
          <Nav />
          <SignOutButton />
        </div>
      </header>

      {error ? (
        <p className="mt-8 text-[var(--color-negative)]">{error}</p>
      ) : holdings ? (
        <div className="mt-6">
          <Investments initial={holdings} />
        </div>
      ) : (
        <p className="mt-8 text-[var(--color-text-secondary)]">Loading…</p>
      )}
    </main>
  );
}
