// Data-driven signals per ticker: company name, 52-week range, 50/200-day SMAs,
// RSI(14), and analyst consensus. Two providers, both cached aggressively (~8h):
//
// Finnhub (free tier — verify against the live key via the `tier` flags):
//   /stock/profile2        free     (company name)        -> cached permanently
//   /stock/metric          free     (52-week high/low)
//   /stock/recommendation  free     (buy/hold/sell trend)
//   /stock/candle          PREMIUM  -> NOT used; SMA/RSI come from Twelve Data
//
// Twelve Data (free tier: 8 calls/min, 800/day) supplies ONLY the 50/200-day
// SMA and RSI(14) that Finnhub's premium candle endpoint can't. One time_series
// call per ticker per refresh, drained through a background queue throttled to
// the 8/min limit (see runTwelveWorker) so a cold batch never blocks /signals.
//
// Financial Modeling Prep (FMP) supplies the analyst price-target consensus
// (Finnhub's target endpoint is premium). Fetched in computeSignal, cached ~8h.
//
// Each signal also carries a computed entryRating (attractive/neutral/extended)
// + entryReason — see computeEntryRating for the exact thresholds.
//
// Finnhub cost control: each endpoint carries a tier flag; the first 403 flips
// it false and we STOP calling it for the rest of the batch — so a free key
// probes a premium endpoint once, not once per ticker.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { getQuotes } from "./prices.js";

const DATA_DIR = process.env.DATA_DIR || "/data";
const NAMES_PATH = DATA_DIR + "/names.json";

const SIGNAL_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const FETCH_TIMEOUT_MS = 8000;
const CONCURRENCY = 4; // stay well under Finnhub's 60 req/min free limit

// Twelve Data throttle: ≥8s between calls → ≤7.5/min, under the 8/min free cap.
const TWELVE_TTL_MS = SIGNAL_TTL_MS;
const TWELVE_SPACING_MS = 8000;

// Per-endpoint access: null = unknown, true = works, false = premium/denied/bad
// key. Once false we skip it for the rest of the process life. `twelveData`
// tracks the Twelve Data MA/RSI source the same way (false on auth/plan reject).
const tier = {
  metric: null,
  recommendation: null,
  priceTarget: null,
  twelveData: null,
};

// { [TICKER]: { fetchedAt, data } } — Finnhub-derived fields.
const signalCache = {};

// Twelve Data MA/RSI cache + a throttled background queue. We never block a
// /signals response on Twelve Data (its rate limit would mean minutes of latency
// for a cold batch); instead we serve cached values and refill in the
// background, so MA/RSI populate within a few minutes of the first request.
const twelveCache = {}; // { [TICKER]: { fetchedAt, ma50, ma200, rsi14 } }
const twelveQueue = [];
const twelvePending = new Set();
let twelveWorking = false;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ~1 year of daily closes from Twelve Data, oldest→newest. Returns null on any
// failure (missing key, rate limit, error body) so MA/RSI just stay null and the
// Finnhub-sourced fields still render.
async function fetchTwelveCloses(ticker) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) return null;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    ticker,
  )}&interval=1day&outputsize=250&apikey=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    console.error("[bridge] Twelve Data fetch failed:", ticker, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json().catch(() => null);
  // Twelve Data reports errors in the body with status:"error" + a numeric code,
  // often still on HTTP 200.
  if (data && data.status === "error") {
    if (data.code === 401 || data.code === 403) {
      if (tier.twelveData !== false) {
        console.warn(
          "[bridge] Twelve Data key/plan rejected — MA/RSI unavailable:",
          data.message,
        );
      }
      tier.twelveData = false;
    } else if (data.code === 429) {
      console.warn("[bridge] Twelve Data rate limited for", ticker);
    } else {
      console.error("[bridge] Twelve Data error for", ticker, data.message);
    }
    return null;
  }
  if (!res.ok || !data || !Array.isArray(data.values) || data.values.length === 0) {
    return null;
  }

  tier.twelveData = true;
  // `values` is newest-first; reverse to chronological for the RSI walk.
  return data.values
    .map((v) => Number(v.close))
    .filter((n) => Number.isFinite(n))
    .reverse();
}

function enqueueTwelve(ticker) {
  if (twelvePending.has(ticker)) return;
  twelvePending.add(ticker);
  twelveQueue.push(ticker);
  if (!twelveWorking) runTwelveWorker();
}

// Drains the queue one ticker at a time with spacing to honor the 8/min limit.
// Runs detached (never awaited by a request); failures leave MA/RSI null.
async function runTwelveWorker() {
  twelveWorking = true;
  try {
    while (twelveQueue.length) {
      const ticker = twelveQueue.shift();
      try {
        const closes = await fetchTwelveCloses(ticker);
        if (closes && closes.length) {
          twelveCache[ticker] = {
            fetchedAt: Date.now(),
            ma50: round(sma(closes, 50)),
            ma200: round(sma(closes, 200)),
            rsi14: round(rsi(closes, 14)),
          };
        }
      } catch (err) {
        console.error("[bridge] Twelve Data worker error:", ticker, err.message);
      } finally {
        twelvePending.delete(ticker);
      }
      if (twelveQueue.length) await sleep(TWELVE_SPACING_MS);
    }
  } finally {
    twelveWorking = false;
  }
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

// Analyst price-target consensus from Financial Modeling Prep (Finnhub's target
// endpoint is premium). FMP's free tier may gate this too — on a 401/402/403 or
// an "Error Message" mentioning a plan/legacy/premium limit we flip
// tier.priceTarget false and stop trying. Returns { mean, high, low } or null.
async function fetchPriceTarget(ticker) {
  const key = process.env.FMP_API_KEY;
  if (!key || tier.priceTarget === false) return null;

  const url = `https://financialmodelingprep.com/api/v3/price-target-consensus?symbol=${encodeURIComponent(
    ticker,
  )}&apikey=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    console.error("[bridge] FMP price-target fetch failed:", ticker, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 402 || res.status === 403) {
    if (tier.priceTarget !== false) {
      console.warn("[bridge] FMP price targets not available on this plan (HTTP", res.status + ")");
    }
    tier.priceTarget = false;
    return null;
  }

  const data = await res.json().catch(() => null);
  // FMP returns errors as an object { "Error Message": "..." } (often HTTP 200).
  if (data && !Array.isArray(data) && data["Error Message"]) {
    const msg = String(data["Error Message"]);
    if (/premium|exclusive|legacy|upgrade|plan|not available|subscription/i.test(msg)) {
      if (tier.priceTarget !== false) {
        console.warn("[bridge] FMP price targets gated:", msg);
      }
      tier.priceTarget = false;
    } else {
      console.error("[bridge] FMP price-target error for", ticker, msg);
    }
    return null;
  }
  if (!res.ok || !Array.isArray(data) || data.length === 0) return null;

  tier.priceTarget = true;
  const row = data[0];
  const mean = num(row.targetConsensus) ?? num(row.targetMedian);
  const high = num(row.targetHigh);
  const low = num(row.targetLow);
  if (mean === null && high === null && low === null) return null;
  return { mean, high, low };
}

// Finnhub-derived fields only. ma50/ma200/rsi14 are merged in from the Twelve
// Data cache at response time (see getSignals).
async function computeSignal(ticker, key) {
  const name = await getProfileName(ticker, key);

  let high52 = null;
  let low52 = null;
  const m = await fetchMetric52(ticker, key);
  if (m) {
    high52 = round(m.high52);
    low52 = round(m.low52);
  }

  const recommendation = await fetchRecommendation(ticker, key);
  const priceTarget = await fetchPriceTarget(ticker);

  return { name, high52, low52, recommendation, priceTarget };
}

// Entry rating for a cost-averaging long-term investor — deliberately biased
// toward "reasonable to add" over "wait for a crash". Each available sub-signal
// contributes ±1 to a net score; we map the net to a rating, with two explicit
// EXTENDED overrides. Degrades gracefully: only present sub-signals are scored,
// and with none we return null.
//
// Sub-signals (each ±1, using a ±1% deadband around the MAs so we don't flap):
//   (a) price vs 50-day MA   : < MA50*0.99 -> +1 ; > MA50*1.01 -> -1 ; else 0
//   (b) price vs 200-day MA  : < MA200*0.99 -> +1 ; > MA200*1.01 -> -1 ; else 0
//   (c) RSI(14)              : < 45 -> +1 ; > 70 -> -1 ; else 0
//   (d) price vs avg target  : < target*0.90 (>10% upside) -> +1 ;
//                              >= target (at/above) -> -1 ; else 0
//   (e) analyst rating       : Strong Buy/Buy -> +1 ; Sell/Strong Sell -> -1
//
// Mapping (bias toward attractive — one net-positive signal is enough; it takes
// two net-negative to call something extended):
//   EXTENDED  if (above BOTH MAs by >1% AND RSI > 70)  [hot momentum override]
//          or if price >= avg target                    [valuation override]
//          or if net score <= -2
//   ATTRACTIVE if net score >= +1
//   NEUTRAL    otherwise (net score 0 or -1)
export function computeEntryRating(price, s) {
  let score = 0;
  let scored = 0;
  const reasons = [];

  const { ma50, ma200, rsi14: rsi } = s;
  const target = s.priceTarget?.mean ?? null;
  const rating = s.recommendation?.label ?? null;

  if (price != null && ma50 != null && ma50 > 0) {
    scored++;
    if (price < ma50 * 0.99) {
      score += 1;
      reasons.push("below 50-day");
    } else if (price > ma50 * 1.01) {
      score -= 1;
      reasons.push("above 50-day");
    } else {
      reasons.push("near 50-day");
    }
  }

  if (price != null && ma200 != null && ma200 > 0) {
    scored++;
    if (price < ma200 * 0.99) {
      score += 1;
      reasons.push("below 200-day");
    } else if (price > ma200 * 1.01) {
      score -= 1;
      reasons.push("above 200-day");
    } else {
      reasons.push("near 200-day");
    }
  }

  if (rsi != null) {
    scored++;
    if (rsi < 45) {
      score += 1;
      reasons.push(`RSI ${Math.round(rsi)} soft`);
    } else if (rsi > 70) {
      score -= 1;
      reasons.push(`RSI ${Math.round(rsi)} hot`);
    } else {
      reasons.push(`RSI ${Math.round(rsi)}`);
    }
  }

  let atOrAboveTarget = false;
  if (price != null && target != null && target > 0) {
    scored++;
    if (price >= target) {
      score -= 1;
      atOrAboveTarget = true;
      reasons.push("at/above target");
    } else if (price < target * 0.9) {
      score += 1;
      reasons.push("well below target");
    } else {
      reasons.push("below target");
    }
  }

  if (rating) {
    scored++;
    if (rating === "Strong Buy" || rating === "Buy") {
      score += 1;
      reasons.push(`analysts ${rating}`);
    } else if (rating === "Sell" || rating === "Strong Sell") {
      score -= 1;
      reasons.push(`analysts ${rating}`);
    } else {
      reasons.push(`analysts ${rating}`);
    }
  }

  if (scored === 0) return { entryRating: null, entryReason: null };

  const aboveBothMas =
    price != null &&
    ma50 != null &&
    ma200 != null &&
    price > ma50 * 1.01 &&
    price > ma200 * 1.01;
  const hotMomentum = aboveBothMas && rsi != null && rsi > 70;

  let entryRating;
  if (hotMomentum || atOrAboveTarget || score <= -2) {
    entryRating = "extended";
  } else if (score >= 1) {
    entryRating = "attractive";
  } else {
    entryRating = "neutral";
  }

  const entryReason =
    reasons.length > 0
      ? reasons[0].charAt(0).toUpperCase() + reasons[0].slice(1) + reasons.slice(1).map((r) => `, ${r}`).join("")
      : null;

  return { entryRating, entryReason };
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

  // Kick off (don't await) a background Twelve Data refresh for any ticker whose
  // MA/RSI are missing or past the TTL. The throttled worker fills the cache for
  // subsequent requests without blocking this one.
  for (const t of unique) {
    const tw = twelveCache[t];
    const fresh = tw && now - tw.fetchedAt < TWELVE_TTL_MS;
    if (force || !fresh) enqueueTwelve(t);
  }

  // Current prices for the entry rating (price vs MA / target). Shares the 30-min
  // /prices cache, so this adds no Finnhub calls. Degrade to no prices on error.
  let quotes = {};
  try {
    ({ quotes } = await getQuotes(unique));
  } catch (err) {
    console.error("[bridge] /signals could not load quotes for entry rating:", err.message);
  }

  const signals = {};
  let oldest = now;
  for (const t of unique) {
    if (!signalCache[t]) {
      signals[t] = null;
      continue;
    }
    const tw = twelveCache[t] || {};
    const merged = {
      ...signalCache[t].data,
      ma50: tw.ma50 ?? null,
      ma200: tw.ma200 ?? null,
      rsi14: tw.rsi14 ?? null,
    };
    const { entryRating, entryReason } = computeEntryRating(quotes[t] ?? null, merged);
    signals[t] = { ...merged, entryRating, entryReason };
    oldest = Math.min(oldest, signalCache[t].fetchedAt);
  }

  return { signals, fetchedAt: oldest, tier: { ...tier } };
}
