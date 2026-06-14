// Investments holdings store — a small, SDK-independent JSON file in the same
// persistent data directory the Actual SDK uses. This is its own concern: no
// Actual Budget data, no price feed (that's a later stage), just manually
// entered lots and a per-ticker cost-basis rollup.
//
// The file is read-modify-written synchronously. Sync fs calls block the event
// loop for the duration of a single handler, which makes each append atomic
// against the others — good enough for this single-user, low-traffic store and
// far simpler than the SDK's serialize() chain (which only exists because the
// Actual SDK keeps module-global state; this doesn't).

import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";

const DATA_DIR = process.env.DATA_DIR || "/data";
const HOLDINGS_PATH = DATA_DIR + "/holdings.json";

// Thrown for bad client input so the route can answer 400 instead of 500.
export class ValidationError extends Error {}

// Initial lots written on first read when no file exists yet. The blended seeds
// carry a single synthetic purchase date; the gifted TSLA lot has no known cost
// basis (basisUnknown), so the rollup excludes it from the cost math while still
// counting its shares.
const SEED_LOTS = [
  { ticker: "TSLA", shares: 31.83, pricePerShare: 309.0, purchaseDate: "2025-12-01", note: "blended seed" },
  { ticker: "TSLA", shares: 38, pricePerShare: 0, purchaseDate: "2025-12-01", note: "gifted from mom Dec 2025, basis TBD", basisUnknown: true },
  { ticker: "NVDA", shares: 4.18, pricePerShare: 188.51, purchaseDate: "2025-12-01", note: "blended seed" },
  { ticker: "GOOG", shares: 1.29, pricePerShare: 387.78, purchaseDate: "2025-12-01", note: "blended seed" },
];

// Round away binary-float fuzz (e.g. 31.83 * 309 → …0001). dp = decimal places.
function round(n, dp) {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function loadLots() {
  if (!existsSync(HOLDINGS_PATH)) {
    const seeded = SEED_LOTS.map((lot) => ({ id: randomUUID(), ...lot }));
    writeFileSync(HOLDINGS_PATH, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const parsed = JSON.parse(readFileSync(HOLDINGS_PATH, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

// Per-ticker rollup. basisUnknown lots count toward totalShares (and are surfaced
// separately as basisUnknownShares) but are kept out of weightedAvgCost /
// totalCostBasis so a $0 placeholder basis can't drag the average down.
function computeRollups(lots) {
  const byTicker = new Map();
  for (const lot of lots) {
    let r = byTicker.get(lot.ticker);
    if (!r) {
      r = { ticker: lot.ticker, totalShares: 0, totalCostBasis: 0, pricedShares: 0, basisUnknownShares: 0 };
      byTicker.set(lot.ticker, r);
    }
    r.totalShares += lot.shares;
    if (lot.basisUnknown) {
      r.basisUnknownShares += lot.shares;
    } else {
      r.totalCostBasis += lot.shares * lot.pricePerShare;
      r.pricedShares += lot.shares;
    }
  }
  return [...byTicker.values()]
    .map((r) => ({
      ticker: r.ticker,
      totalShares: round(r.totalShares, 4),
      weightedAvgCost: r.pricedShares > 0 ? round(r.totalCostBasis / r.pricedShares, 2) : null,
      totalCostBasis: round(r.totalCostBasis, 2),
      basisUnknownShares: round(r.basisUnknownShares, 4),
    }))
    .sort((a, b) => b.totalCostBasis - a.totalCostBasis || a.ticker.localeCompare(b.ticker));
}

export function getHoldings() {
  const lots = loadLots();
  return { lots, rollups: computeRollups(lots) };
}

// Validate, append, persist, return the new lot. Manual entry never sets a cost
// basis as unknown — that flag is reserved for the seeded gift lot.
export function addLot(input) {
  const ticker = typeof input.ticker === "string" ? input.ticker.trim().toUpperCase() : "";
  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
    throw new ValidationError("ticker must be a 1–12 character symbol");
  }

  const shares = Number(input.shares);
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new ValidationError("shares must be a positive number");
  }

  const pricePerShare = Number(input.pricePerShare);
  if (!Number.isFinite(pricePerShare) || pricePerShare < 0) {
    throw new ValidationError("pricePerShare must be a non-negative number");
  }

  const purchaseDate = input.purchaseDate;
  if (typeof purchaseDate !== "string" || Number.isNaN(Date.parse(purchaseDate))) {
    throw new ValidationError("purchaseDate must be a parseable date");
  }

  const note = input.note == null ? "" : String(input.note);

  const lot = { id: randomUUID(), ticker, shares, pricePerShare, purchaseDate, note };
  const lots = loadLots();
  lots.push(lot);
  writeFileSync(HOLDINGS_PATH, JSON.stringify(lots, null, 2));
  return lot;
}
