import { readFileSync } from "fs";
import { createServer as createHttpsServer } from "https";
import { createServer as createHttpServer } from "http";
import { timingSafeEqual } from "crypto";
import express from "express";
import { getAccounts, getTransactions, runSync, getGroups, getScheduledBills, getBudget } from "./actual.js";
import { getHoldings, addLot, ValidationError } from "./holdings.js";


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
