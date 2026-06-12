import { readFileSync } from "fs";
import { createServer as createHttpsServer } from "https";
import { createServer as createHttpServer } from "http";
import { timingSafeEqual } from "crypto";
import express from "express";
import { getAccounts, getTransactions } from "./actual.js";

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
