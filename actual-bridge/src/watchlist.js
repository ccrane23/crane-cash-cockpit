// Watchlist store — buy-zone targets for tickers we're tracking but don't
// necessarily hold. Same file-backed, SDK-independent pattern as holdings.js;
// its own JSON file in DATA_DIR. Read-modify-write is synchronous, which keeps
// each mutation atomic against the others for this single-user store.

import { randomUUID } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";

const DATA_DIR = process.env.DATA_DIR || "/data";
const WATCHLIST_PATH = DATA_DIR + "/watchlist.json";

// Thrown for bad client input so the route can answer 400 instead of 500.
export class ValidationError extends Error {}

// Initial entries written on first read. The price-zone names are seeded
// stale:true — they're old targets to re-verify; editing a zone clears the flag
// (see updateWatchlistEntry). The space ETFs have no fixed zone and aren't stale.
const SEED = [
  { ticker: "MSFT", zoneLow: 370, zoneHigh: 410, stale: true },
  { ticker: "GOOG", zoneLow: 355, zoneHigh: 400, stale: true },
  { ticker: "NVDA", zoneLow: 170, zoneHigh: 195, stale: true },
  { ticker: "AMZN", zoneLow: 225, zoneHigh: 250, stale: true },
  { ticker: "ISRG", zoneLow: 428, zoneHigh: 470, stale: true },
  { ticker: "KO", zoneLow: 63, zoneHigh: 68, stale: true },
  { ticker: "MELI", zoneLow: 1495, zoneHigh: 1700, stale: true },
  { ticker: "VRT", zoneLow: 270, zoneHigh: 305, stale: true },
  { ticker: "TSLA", zoneLow: 340, zoneHigh: 385, stale: true },
  { ticker: "AVGO", zoneLow: 340, zoneHigh: 380, stale: true },
  { ticker: "TSM", zoneLow: 310, zoneHigh: 350, stale: true },
  { ticker: "SYM", zoneLow: 30, zoneHigh: 40, stale: true },
  { ticker: "RKLB", zoneLow: 80, zoneHigh: 100, stale: true },
  { ticker: "OKLO", zoneLow: 45, zoneHigh: 60, stale: true },
  { ticker: "CBRS", zoneLow: 150, zoneHigh: 185, stale: true },
  { ticker: "NASA", zoneLow: null, zoneHigh: null, stale: false },
  { ticker: "ARKX", zoneLow: null, zoneHigh: null, stale: false },
  { ticker: "ROKT", zoneLow: null, zoneHigh: null, stale: false },
];

function loadEntries() {
  if (!existsSync(WATCHLIST_PATH)) {
    const seeded = SEED.map((s) => ({ id: randomUUID(), note: "", ...s }));
    writeFileSync(WATCHLIST_PATH, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const parsed = JSON.parse(readFileSync(WATCHLIST_PATH, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function save(entries) {
  writeFileSync(WATCHLIST_PATH, JSON.stringify(entries, null, 2));
}

function parseTicker(value) {
  const ticker = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
    throw new ValidationError("ticker must be a 1–12 character symbol");
  }
  return ticker;
}

// Zone bounds are optional: null / "" / undefined all mean "no bound". Anything
// present must be a non-negative number.
function parseZone(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidationError(`${label} must be a non-negative number or blank`);
  }
  return n;
}

export function getWatchlist() {
  return { entries: loadEntries() };
}

// Tickers tracked on the watchlist, for the shared price fetch.
export function getWatchlistTickers() {
  return loadEntries().map((e) => e.ticker);
}

export function addWatchlistEntry(input) {
  const ticker = parseTicker(input.ticker);
  const zoneLow = parseZone(input.zoneLow, "zoneLow");
  const zoneHigh = parseZone(input.zoneHigh, "zoneHigh");
  if (zoneLow !== null && zoneHigh !== null && zoneLow > zoneHigh) {
    throw new ValidationError("zoneLow must not exceed zoneHigh");
  }
  const note = input.note == null ? "" : String(input.note);

  // A freshly-entered zone is verified by definition, so never seed it stale.
  const entry = { id: randomUUID(), ticker, zoneLow, zoneHigh, note, stale: false };
  const entries = loadEntries();
  entries.push(entry);
  save(entries);
  return entry;
}

// Patch any of ticker / zoneLow / zoneHigh / note. Touching either zone bound
// counts as the user verifying the zone, so stale is cleared automatically.
// Returns the updated entry, or null (→ 404) when the id isn't present.
export function updateWatchlistEntry(id, patch) {
  const entries = loadEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const entry = entries[idx];

  if (patch.ticker !== undefined) {
    entry.ticker = parseTicker(patch.ticker);
  }
  let zonesEdited = false;
  if ("zoneLow" in patch) {
    entry.zoneLow = parseZone(patch.zoneLow, "zoneLow");
    zonesEdited = true;
  }
  if ("zoneHigh" in patch) {
    entry.zoneHigh = parseZone(patch.zoneHigh, "zoneHigh");
    zonesEdited = true;
  }
  if (patch.note !== undefined) {
    entry.note = String(patch.note);
  }
  if (entry.zoneLow !== null && entry.zoneHigh !== null && entry.zoneLow > entry.zoneHigh) {
    throw new ValidationError("zoneLow must not exceed zoneHigh");
  }
  if (zonesEdited) entry.stale = false;

  entries[idx] = entry;
  save(entries);
  return entry;
}

export function deleteWatchlistEntry(id) {
  const entries = loadEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  save(entries);
  return true;
}
