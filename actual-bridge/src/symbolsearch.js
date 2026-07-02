// Symbol search proxy over Finnhub's /search endpoint. Powers the dashboard's
// add-stock autocomplete so users pick a real ticker instead of free-typing one
// that might not exist.
//
// Cost / quality notes:
//   - Finnhub /search returns GLOBAL results (foreign listings, crypto, forex,
//     mutual funds). We filter to US-equity-shaped symbols so a query for "AAPL"
//     doesn't surface AAPL.SW (Swiss), RIGD.IL (London), etc. See US_SYMBOL.
//   - Results are deduped by symbol and capped so the dropdown stays short.
//   - Any failure (no key, network, timeout, bad JSON) degrades to an EMPTY list
//     rather than throwing — the caller never crashes and the UI shows "no
//     matches". Reuses the existing FINNHUB_API_KEY.

const FINNHUB_SEARCH_URL = "https://finnhub.io/api/v1/search";
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESULTS = 10;

// US-equity-shaped ticker: 1-5 uppercase letters, with an optional single-letter
// class suffix (keeps BRK.A / BRK.B). This deliberately excludes:
//   - foreign-exchange listings (AAPL.SW, RIGD.IL — multi-letter suffix)
//   - crypto / forex pairs (BINANCE:BTCUSDT — contain a colon)
// It's a heuristic, not an exchange lookup (the free tier has no US-only filter).
const US_SYMBOL = /^[A-Z]{1,5}(\.[A-Z])?$/;

/**
 * Search Finnhub for symbols matching `query`, cleaned to US-equity results.
 * @param {string} query
 * @returns {Promise<Array<{ symbol: string, description: string }>>}
 */
export async function searchSymbols(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    console.warn("[bridge] /symbol-search: FINNHUB_API_KEY is not set");
    return [];
  }

  const url = `${FINNHUB_SEARCH_URL}?q=${encodeURIComponent(q)}&token=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  let data;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      console.warn(`[bridge] /symbol-search: Finnhub returned ${res.status}`);
      return [];
    }
    data = await res.json();
  } catch (err) {
    console.warn(
      "[bridge] /symbol-search failed:",
      err && err.message ? err.message : err,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }

  const rows = Array.isArray(data && data.result) ? data.result : [];
  const seen = new Set();
  const cleaned = [];
  for (const row of rows) {
    const symbol = String((row && row.symbol) || "").toUpperCase();
    const description = String((row && row.description) || "").trim();
    if (!symbol || !description) continue;
    if (!US_SYMBOL.test(symbol)) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    cleaned.push({ symbol, description });
    if (cleaned.length >= MAX_RESULTS) break;
  }
  return cleaned;
}
