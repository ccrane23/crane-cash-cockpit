// Live quote fetching from Finnhub, with a process-memory cache.
//
// Cost control: Finnhub's free tier is rate-limited and we pay per call, so we
// fetch at most once per TTL window regardless of how many times the tab is
// opened. A manual refresh (force=true) bypasses the cache. The cache also
// re-fetches when a newly added ticker isn't covered yet, so a fresh holding
// doesn't show a blank price until the window expires.

const FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// { fetchedAt: epoch ms (0 = never), quotes: { TICKER: price|null } }
let cache = { fetchedAt: 0, quotes: {} };

async function fetchQuote(ticker, key) {
  const url = `${FINNHUB_QUOTE_URL}?symbol=${encodeURIComponent(ticker)}&token=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${ticker} returned ${res.status}`);
  const data = await res.json();
  // `c` is the current price. Finnhub returns c:0 for unknown symbols, so treat
  // a non-positive value as "no data" rather than a real $0 quote.
  const price = typeof data.c === "number" && data.c > 0 ? data.c : null;
  return price;
}

/**
 * Current price per unique ticker. Individual failures degrade to null so one
 * bad symbol can't sink the whole batch.
 *
 * @param {string[]} tickers
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{ quotes: Record<string, number|null>, fetchedAt: number, stale: boolean }>}
 */
export async function getQuotes(tickers, { force = false } = {}) {
  const unique = [
    ...new Set(tickers.map((t) => String(t).toUpperCase()).filter(Boolean)),
  ];

  const now = Date.now();
  const fresh = now - cache.fetchedAt < CACHE_TTL_MS;
  const covered = unique.every((t) => t in cache.quotes);
  if (!force && fresh && covered) {
    // Served from cache without a network call — `stale` flags that for the UI.
    return { quotes: cache.quotes, fetchedAt: cache.fetchedAt, stale: true };
  }

  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set");

  const results = await Promise.all(
    unique.map(async (ticker) => {
      try {
        return [ticker, await fetchQuote(ticker, key)];
      } catch (err) {
        console.error("[bridge] quote failed:", ticker, err.message);
        return [ticker, null];
      }
    }),
  );

  cache = { fetchedAt: now, quotes: Object.fromEntries(results) };
  return { quotes: cache.quotes, fetchedAt: now, stale: false };
}
