import { readFileSync } from "fs";
import { createServer as createHttpsServer } from "https";
import { createServer as createHttpServer } from "http";
import { timingSafeEqual } from "crypto";
import express from "express";
import { getAccounts, getTransactions, runSync, getGroups, getScheduledBills, getBudget } from "./actual.js";
import { getHoldings, addLot, deleteLot, ValidationError } from "./holdings.js";
import {
  getWatchlist,
  getWatchlistTickers,
  addWatchlistEntry,
  updateWatchlistEntry,
  deleteWatchlistEntry,
  ValidationError as WatchlistValidationError,
} from "./watchlist.js";
import { getQuotes } from "./prices.js";
import { searchSymbols } from "./symbolsearch.js";
import { getSignals } from "./signals.js";
import { getDeepDive, getDeepDiveStats, DeepDiveError } from "./deepdive.js";


// Safety net: the Actual SDK can emit async errors that escape try/catch and
// would otherwise crash the process. Log them instead of dying so one bad bank
// connection can't take the bridge down.
process.on("unhandledRejection", (reason) => {
  console.error("[bridge] unhandledRejection:", reason && reason.message ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[bridge] uncaughtException:", err && err.message ? err.message : err);
});

const PORT = Number(process.env.PORT || 5007);

const TOKEN = process.env.BRIDGE_BEARER_TOKEN;
if (!TOKEN) {
  console.error("BRIDGE_BEARER_TOKEN is not set");
  process.exit(1);
}

// TLS is on by default (production). For local testing where no letsencrypt cert
// exists, set TLS_DISABLED=1 to listen over plain HTTP instead.
const TLS_DISABLED = process.env.TLS_DISABLED === "1";
const TLS_CERT =
  process.env.TLS_CERT || "/etc/letsencrypt/live/cranecashapp.com/fullchain.pem";
const TLS_KEY =
  process.env.TLS_KEY || "/etc/letsencrypt/live/cranecashapp.com/privkey.pem";

const app = express();
app.use(express.json());

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function requireBearer(req, res, next) {
  const header = req.get("authorization") || "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix) || !safeEqual(header.slice(prefix.length), TOKEN)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// Healthcheck — no auth, no SDK work. Used by docker/uptime probes.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/accounts", requireBearer, async (_req, res) => {
  try {
    const accounts = await getAccounts();
    res.json({ accounts });
  } catch (err) {
    console.error("[bridge] /accounts failed:", err);
    res.status(502).json({ error: "actual_unreachable" });
  }
});app.get("/transactions", requireBearer, async (req, res) => {
  try {
    const { start, end } = req.query;
    const transactions = await getTransactions(start, end);
    res.json({ transactions });
  } catch (err) {
    console.error("[bridge] /transactions failed:", err);
    res.status(502).json({ error: "actual_unreachable" });
  }
});

app.post("/sync", requireBearer, async (_req, res) => {
  try {
    const result = await runSync();
    res.json(result);
  } catch (err) {
    console.error("[bridge] /sync failed:", err);
    res.status(502).json({ error: "actual_unreachable" });
  }
});

app.get("/sync-status", requireBearer, (_req, res) => {
  try {
    const p = (process.env.DATA_DIR || "/data") + "/last-sync.json";
    const raw = readFileSync(p, "utf8");
    res.json(JSON.parse(raw));
  } catch (err) {
    // No sync has run yet (file missing) or unreadable.
    res.json({ syncedAt: null, ok: null, failures: [], accounts: [] });
  }
});

app.get("/groups", requireBearer, async (_req, res) => {
  try {
    const groups = await getGroups();
    res.json({ groups });
  } catch (err) {
    console.error("[bridge] /groups failed:", err);
    res.status(502).json({ error: "actual_unreachable" });
  }
});

app.get("/schedules", requireBearer, async (_req, res) => {
  try {
    const schedules = await getScheduledBills();
    res.json({ schedules });
  } catch (err) {
    console.error("[bridge] /schedules failed:", err);
    res.status(502).json({ error: "actual_unreachable" });
  }
});

app.get("/budget", requireBearer, async (req, res) => {
  try {
    const budget = await getBudget(req.query.month);
    res.json(budget);
  } catch (err) {
    console.error("[bridge] /budget failed:", err);
    res.status(502).json({ error: "actual_unreachable" });
  }
});

// Investments holdings store — file-backed, independent of the Actual SDK.
app.get("/holdings", requireBearer, (_req, res) => {
  try {
    res.json(getHoldings());
  } catch (err) {
    console.error("[bridge] /holdings failed:", err);
    res.status(500).json({ error: "holdings_unavailable" });
  }
});

app.post("/holdings", requireBearer, (req, res) => {
  try {
    const lot = addLot(req.body || {});
    res.status(201).json({ lot });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("[bridge] POST /holdings failed:", err);
    res.status(500).json({ error: "holdings_unavailable" });
  }
});

app.delete("/holdings/:id", requireBearer, (req, res) => {
  try {
    const removed = deleteLot(req.params.id);
    if (!removed) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    console.error("[bridge] DELETE /holdings failed:", err);
    res.status(500).json({ error: "holdings_unavailable" });
  }
});

// Live prices for every ticker we hold OR watch. The union is deduped inside
// getQuotes (a ticker held and watched is fetched once and shares one quote).
// Cached ~30 min on the bridge; ?force=true bypasses the cache.
app.get("/prices", requireBearer, async (req, res) => {
  try {
    const { rollups } = getHoldings();
    const tickers = [...rollups.map((r) => r.ticker), ...getWatchlistTickers()];
    const force = req.query.force === "true";
    res.json(await getQuotes(tickers, { force }));
  } catch (err) {
    console.error("[bridge] /prices failed:", err);
    res.status(502).json({ error: "prices_unavailable" });
  }
});

// Data-driven signals (name, 52w range, SMAs, RSI, analyst) for every held or
// watched ticker. Computed from Finnhub, cached ~8h. ?force=true bypasses cache.
// Premium-only fields degrade to null — see the `tier` flags in the response.
app.get("/signals", requireBearer, async (req, res) => {
  try {
    const { rollups } = getHoldings();
    const tickers = [...rollups.map((r) => r.ticker), ...getWatchlistTickers()];
    const force = req.query.force === "true";
    res.json(await getSignals(tickers, { force }));
  } catch (err) {
    console.error("[bridge] /signals failed:", err);
    res.status(502).json({ error: "signals_unavailable" });
  }
});

// Symbol search for the add-stock autocomplete (holdings + watchlist ticker
// fields). Proxies Finnhub /search and returns a cleaned US-equity list.
// Never errors to the client — a failure degrades to an empty list so the UI
// falls back to "no matches" and manual entry.
app.get("/symbol-search", requireBearer, async (req, res) => {
  try {
    const results = await searchSymbols(req.query.q);
    res.json({ results });
  } catch (err) {
    console.error("[bridge] /symbol-search failed:", err);
    res.json({ results: [] });
  }
});

// Watchlist — tracked tickers. Same Bearer auth as the rest.
app.get("/watchlist", requireBearer, (_req, res) => {
  try {
    res.json(getWatchlist());
  } catch (err) {
    console.error("[bridge] /watchlist failed:", err);
    res.status(500).json({ error: "watchlist_unavailable" });
  }
});

app.post("/watchlist", requireBearer, (req, res) => {
  try {
    const entry = addWatchlistEntry(req.body || {});
    res.status(201).json({ entry });
  } catch (err) {
    if (err instanceof WatchlistValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("[bridge] POST /watchlist failed:", err);
    res.status(500).json({ error: "watchlist_unavailable" });
  }
});

app.patch("/watchlist/:id", requireBearer, (req, res) => {
  try {
    const entry = updateWatchlistEntry(req.params.id, req.body || {});
    if (!entry) return res.status(404).json({ error: "not_found" });
    res.json({ entry });
  } catch (err) {
    if (err instanceof WatchlistValidationError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("[bridge] PATCH /watchlist failed:", err);
    res.status(500).json({ error: "watchlist_unavailable" });
  }
});

app.delete("/watchlist/:id", requireBearer, (req, res) => {
  try {
    const removed = deleteWatchlistEntry(req.params.id);
    if (!removed) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    console.error("[bridge] DELETE /watchlist failed:", err);
    res.status(500).json({ error: "watchlist_unavailable" });
  }
});

// AI deep-dive thesis — the only endpoint that calls Anthropic. Click-only and
// cache-gated (24h per ticker) so repeat clicks never re-charge.
app.post("/deep-dive", requireBearer, async (req, res) => {
  try {
    const result = await getDeepDive((req.body || {}).ticker);
    res.json(result);
  } catch (err) {
    if (err instanceof DeepDiveError) {
      console.error("[bridge] /deep-dive:", err.message);
      return res.status(502).json({ error: "Deep dive unavailable" });
    }
    console.error("[bridge] /deep-dive failed:", err);
    res.status(500).json({ error: "Deep dive unavailable" });
  }
});

// Monthly deep-dive call counter — read-only, never triggers a generation.
app.get("/deep-dive/stats", requireBearer, (_req, res) => {
  try {
    res.json(getDeepDiveStats());
  } catch (err) {
    console.error("[bridge] /deep-dive/stats failed:", err);
    res.status(500).json({ error: "stats_unavailable" });
  }
});

let server;
if (TLS_DISABLED) {
  console.warn("[bridge] TLS_DISABLED=1 — serving plain HTTP (local testing only)");
  server = createHttpServer(app);
} else {
  server = createHttpsServer(
    { cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) },
    app,
  );
}

server.listen(PORT, () => {
  const scheme = TLS_DISABLED ? "http" : "https";
  console.log(`[bridge] listening on ${scheme}://0.0.0.0:${PORT}`);
});
