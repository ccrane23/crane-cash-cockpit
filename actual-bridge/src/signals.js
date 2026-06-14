// Data-driven signals per ticker: company name, 52-week range, 50/200-day SMAs,
// RSI(14), and analyst consensus. Computed from Finnhub and cached aggressively.
//
// Finnhub free-tier reality (must be verified against the live key — see the
// per-endpoint tier flags this module exposes):
//   /quote            free  (price; handled in prices.js, not here)
//   /stock/profile2   free  (company name)            -> cached permanently
//   /stock/metric     free  (52-week high/low)
//   /stock/candle     PREMIUM (daily OHLC) -> needed for SMA/RSI; degrades to null
//   /stock/recommendation  free  (buy/hold/sell trend)
//   /stock/price-target    PREMIUM (mean target)      -> degrades to null
//
// Cost control: each endpoint carries a tier flag. The first 403 flips it to
// false and we STOP calling that endpoint for every remaining ticker — so a
// free-tier key probes a premium endpoint once, not once per ticker. Computed
// signals are cached ~8h (they only move daily); names are cached forever.

import { existsSync, readFileSync, writeFileSync } from "fs";

const DATA_DIR = process.env.DATA_DIR || "/data";
const NAMES_PATH = DATA_DIR + "/names.json";

const SIGNAL_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const FETCH_TIMEOUT_MS = 8000;
const CONCURRENCY = 4; // stay well under Finnhub's 60 req/min free limit

// Per-endpoint access: null = unknown, true = works, false = premium/denied.
// Once false, we skip that endpoint entirely for the rest of the process life.
const tier = {
  candle: null,
  metric: null,
  recommendation: null,
  priceTarget: null,
};

// { [TICKER]: { fetchedAt, data } }
const signalCache = {};

// Persistent company-name cache (names don't change).
let namesCache = null;
function loadNames() {
  if (namesCache) return namesCache;
  try {
    namesCache = JSON.parse(readFileSync(NAMES_PATH, "utf8"));
  } catch {
    namesCache = {};
  }
  return namesCache;
}
function saveNames() {
  try {
    writeFileSync(NAMES_PATH, JSON.stringify(namesCache, null, 2));
  } catch (err) {
    console.error("[bridge] could not persist names cache:", err.message);
  }
}

function round(n, dp = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function finnhubGet(path, key) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://finnhub.io/api/v1${path}${sep}token=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Mark an endpoint premium on the first 403 (and log once).
function notePremium(endpoint, label) {
  if (tier[endpoint] !== false) {
    console.warn(
      `[bridge] Finnhub ${label} returned 403 — not available on this tier; omitting it`,
    );
  }
  tier[endpoint] = false;
}

function sma(closes, n) {
  if (!Array.isArray(closes) || closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((a, b) => a + b, 0) / n;
}

// Wilder's RSI over `period` closes.
function rsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

async function getProfileName(ticker, key) {
  const names = loadNames();
  if (ticker in names) return names[ticker];
  let res;
  try {
    res = await finnhubGet(`/stock/profile2?symbol=${encodeURIComponent(ticker)}`, key);
  } catch (err) {
    console.error("[bridge] profile fetch failed:", ticker, err.message);
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const name = data && data.name ? String(data.name) : null;
  if (name) {
    names[ticker] = name;
    saveNames();
  }
  return name;
}

// Daily candles for ~400 calendar days (≥200 trading days). Returns the raw
// Finnhub payload, or null when unavailable (premium / no data).
async function fetchCandles(ticker, key) {
  if (tier.candle === false) return null;
  const to = Math.floor(Date.now() / 1000);
  const from = to - 400 * 24 * 60 * 60;
  let res;
  try {
    res = await finnhubGet(
      `/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${from}&to=${to}`,
      key,
    );
  } catch (err) {
    console.error("[bridge] candle fetch failed:", ticker, err.message);
    return null;
  }
  if (res.status === 403) {
    notePremium("candle", "/stock/candle");
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (data.s !== "ok" || !Array.isArray(data.c) || data.c.length === 0) return null;
  tier.candle = true;
  return data;
}

async function fetchMetric52(ticker, key) {
  if (tier.metric === false) return null;
  let res;
  try {
    res = await finnhubGet(`/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all`, key);
  } catch (err) {
    console.error("[bridge] metric fetch failed:", ticker, err.message);
    return null;
  }
  if (res.status === 403) {
    notePremium("metric", "/stock/metric");
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  tier.metric = true;
  const m = data.metric || {};
  const high52 = num(m["52WeekHigh"]);
  const low52 = num(m["52WeekLow"]);
  if (high52 === null && low52 === null) return null;
  return { high52, low52 };
}

function recommendationLabel(sb, b, h, s, ss) {
  const bull = sb + b;
  const bear = s + ss;
  const total = sb + b + h + s + ss;
  if (total === 0) return null;
  if (bull >= 2 * (bear + h)) return "Strong Buy";
  if (bull > bear + h) return "Buy";
  if (bear > bull + h) return "Sell";
  return "Hold";
}

async function fetchRecommendation(ticker, key) {
  if (tier.recommendation === false) return null;
  let res;
  try {
    res = await finnhubGet(`/stock/recommendation?symbol=${encodeURIComponent(ticker)}`, key);
  } catch (err) {
    console.error("[bridge] recommendation fetch failed:", ticker, err.message);
    return null;
  }
  if (res.status === 403) {
    notePremium("recommendation", "/stock/recommendation");
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => []);
  tier.recommendation = true;
  if (!Array.isArray(data) || data.length === 0) return null;
  const latest = data[0]; // most recent period first
  const strongBuy = num(latest.strongBuy) ?? 0;
  const buy = num(latest.buy) ?? 0;
  const hold = num(latest.hold) ?? 0;
  const sell = num(latest.sell) ?? 0;
  const strongSell = num(latest.strongSell) ?? 0;
  return {
    strongBuy,
    buy,
    hold,
    sell,
    strongSell,
    period: latest.period ?? null,
    label: recommendationLabel(strongBuy, buy, hold, sell, strongSell),
  };
}

async function fetchPriceTarget(ticker, key) {
  if (tier.priceTarget === false) return null;
  let res;
  try {
    res = await finnhubGet(`/stock/price-target?symbol=${encodeURIComponent(ticker)}`, key);
  } catch (err) {
    console.error("[bridge] price-target fetch failed:", ticker, err.message);
    return null;
  }
  if (res.status === 403) {
    notePremium("priceTarget", "/stock/price-target");
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  tier.priceTarget = true;
  const mean = num(data.targetMean);
  const high = num(data.targetHigh);
  const low = num(data.targetLow);
  if (mean === null && high === null && low === null) return null;
  return { mean, high, low };
}

async function computeSignal(ticker, key) {
  const name = await getProfileName(ticker, key);

  let high52 = null;
  let low52 = null;
  let ma50 = null;
  let ma200 = null;
  let rsi14 = null;

  const candles = await fetchCandles(ticker, key);
  if (candles) {
    const closes = candles.c;
    ma50 = round(sma(closes, 50));
    ma200 = round(sma(closes, 200));
    rsi14 = round(rsi(closes, 14));
    // 52-week range from the same candle data (one fewer API call). Use the
    // last ~252 trading days of daily highs/lows.
    const highs = candles.h.slice(-252);
    const lows = candles.l.slice(-252);
    if (highs.length) high52 = round(Math.max(...highs));
    if (lows.length) low52 = round(Math.min(...lows));
  } else {
    // No candle access — fall back to basic financials for the 52-week range.
    const m = await fetchMetric52(ticker, key);
    if (m) {
      high52 = round(m.high52);
      low52 = round(m.low52);
    }
  }

  const recommendation = await fetchRecommendation(ticker, key);
  const priceTarget = await fetchPriceTarget(ticker, key);

  return { name, high52, low52, ma50, ma200, rsi14, recommendation, priceTarget };
}

async function mapLimit(items, limit, fn) {
  const queue = [...items];
  const runOne = async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) workers.push(runOne());
  await Promise.all(workers);
}

/**
 * Signals for each unique ticker, cached ~8h. Only stale tickers are refetched.
 * @returns {Promise<{ signals: Record<string, object|null>, fetchedAt: number, tier: object }>}
 */
export async function getSignals(tickers, { force = false } = {}) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not set");

  const unique = [
    ...new Set(tickers.map((t) => String(t).toUpperCase()).filter(Boolean)),
  ];
  const now = Date.now();

  const stale = unique.filter(
    (t) =>
      force ||
      !signalCache[t] ||
      now - signalCache[t].fetchedAt >= SIGNAL_TTL_MS,
  );

  await mapLimit(stale, CONCURRENCY, async (t) => {
    try {
      signalCache[t] = { fetchedAt: now, data: await computeSignal(t, key) };
    } catch (err) {
      // Keep any prior cached value; just log this round's failure.
      console.error("[bridge] signal compute failed:", t, err.message);
    }
  });

  const signals = {};
  let oldest = now;
  for (const t of unique) {
    if (signalCache[t]) {
      signals[t] = signalCache[t].data;
      oldest = Math.min(oldest, signalCache[t].fetchedAt);
    } else {
      signals[t] = null;
    }
  }

  return { signals, fetchedAt: oldest, tier: { ...tier } };
}
