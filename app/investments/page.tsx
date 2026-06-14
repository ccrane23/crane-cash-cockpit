import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { describeError } from "@/lib/actual";
import {
  getHoldings,
  getPrices,
  type HoldingsData,
  type PricesData,
} from "@/lib/holdings";
import { getWatchlist, type WatchlistData } from "@/lib/watchlist";
import { getSignals, type SignalsData } from "@/lib/signals";
import Nav from "../Nav";
import SignOutButton from "../sign-out-button";
import Investments from "./Investments";
import Watchlist from "./Watchlist";

// Personal financial data — never cache, always render per request.
export const dynamic = "force-dynamic";

export default async function InvestmentsPage() {
  // Defense in depth alongside proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    redirect("/login");
  }

  // Holdings are essential; prices and the watchlist are best-effort overlays.
  // Fetch independently so a Finnhub outage (or a missing API key) still renders
  // cost-basis figures, and a watchlist hiccup doesn't blank the holdings.
  const [holdingsResult, pricesResult, watchlistResult, signalsResult] =
    await Promise.allSettled([
      getHoldings(),
      getPrices(),
      getWatchlist(),
      getSignals(),
    ]);

  let holdings: HoldingsData | null = null;
  let error: string | null = null;
  if (holdingsResult.status === "fulfilled") {
    holdings = holdingsResult.value;
  } else {
    console.error("Failed to load holdings:", describeError(holdingsResult.reason));
    error = "Could not reach the holdings service.";
  }

  let prices: PricesData | null = null;
  if (pricesResult.status === "fulfilled") {
    prices = pricesResult.value;
  } else {
    console.error("Failed to load prices:", describeError(pricesResult.reason));
  }

  let watchlist: WatchlistData | null = null;
  if (watchlistResult.status === "fulfilled") {
    watchlist = watchlistResult.value;
  } else {
    console.error("Failed to load watchlist:", describeError(watchlistResult.reason));
  }

  let signals: SignalsData | null = null;
  if (signalsResult.status === "fulfilled") {
    signals = signalsResult.value;
  } else {
    console.error("Failed to load signals:", describeError(signalsResult.reason));
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
          <Investments
            initial={holdings}
            initialPrices={prices}
            signals={signals}
          />
        </div>
      ) : (
        <p className="mt-8 text-[var(--color-text-secondary)]">Loading…</p>
      )}

      <div className="mt-10">
        {watchlist ? (
          <Watchlist
            initial={watchlist}
            initialPrices={prices}
            initialSignals={signals}
          />
        ) : (
          <section>
            <div className="mb-3 px-1">
              <p className="mini-label">Watchlist</p>
            </div>
            <p className="bg-[var(--color-surface)] px-5 py-4 text-sm text-[var(--color-text-tertiary)]">
              Watchlist is unavailable right now.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
