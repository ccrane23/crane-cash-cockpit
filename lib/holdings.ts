// Server-side client for the bridge's investments holdings store. Mirrors the
// fetch+Bearer pattern in lib/actual.ts. Stage 1 is cost-basis only — no price
// feed — so everything here is manual entry and weighted-average cost.
//
// Contract (must match actual-bridge/src/holdings.js):
//   GET  {BRIDGE_URL}/holdings    Authorization: Bearer {BRIDGE_BEARER_TOKEN}
//   200 -> { lots: Lot[], rollups: TickerRollup[] }
//   POST {BRIDGE_URL}/holdings    body: NewLotInput
//   201 -> { lot: Lot }
//   400 -> { error: string }   (validation failure)

export type Lot = {
  id: string;
  ticker: string;
  shares: number;
  pricePerShare: number;
  purchaseDate: string; // ISO date
  note: string;
  basisUnknown?: boolean;
};

// Per-ticker rollup computed by the bridge. weightedAvgCost is null when a
// ticker has no priced lots. basisUnknownShares is surfaced separately so the UI
// can show "N shares, basis TBD" instead of a fake $0 cost.
export type TickerRollup = {
  ticker: string;
  totalShares: number;
  weightedAvgCost: number | null;
  totalCostBasis: number;
  basisUnknownShares: number;
};

export type HoldingsData = {
  lots: Lot[];
  rollups: TickerRollup[];
};

export type NewLotInput = {
  ticker: string;
  shares: number;
  pricePerShare: number;
  purchaseDate: string;
  note?: string;
};

// Current price per ticker (null when the quote couldn't be fetched). Mirrors
// the bridge's /prices payload.
export type Quotes = Record<string, number | null>;

export type PricesData = {
  quotes: Quotes;
  fetchedAt: number; // epoch ms; 0 when never fetched
  stale: boolean; // true when served from the bridge's cache (no fresh fetch)
};

// Carries the bridge's HTTP status so the API route can relay a 400 validation
// message to the client instead of collapsing every failure into a 502.
export class BridgeHoldingsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BridgeHoldingsError";
    this.status = status;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function getHoldings(): Promise<HoldingsData> {
  const baseUrl = requireEnv("BRIDGE_URL");
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/holdings`, {
    headers: { Authorization: `Bearer ${token}` },
    // Personal financial data — never cache.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /holdings returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as Partial<HoldingsData>;
  if (!Array.isArray(data.lots) || !Array.isArray(data.rollups)) {
    throw new Error("Bridge /holdings response missing 'lots' / 'rollups'");
  }
  return { lots: data.lots, rollups: data.rollups };
}

export async function addHolding(input: NewLotInput): Promise<Lot> {
  const baseUrl = requireEnv("BRIDGE_URL");
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/holdings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // The bridge replies with { error } on validation failure; prefer that
    // message so the user sees "shares must be a positive number".
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      // non-JSON body; keep the raw text
    }
    throw new BridgeHoldingsError(res.status, message);
  }

  const data = (await res.json()) as { lot?: Lot };
  if (!data.lot) {
    throw new Error("Bridge POST /holdings response missing 'lot'");
  }
  return data.lot;
}

export async function getPrices(opts?: { force?: boolean }): Promise<PricesData> {
  const baseUrl = requireEnv("BRIDGE_URL");
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const url = new URL(`${baseUrl.replace(/\/$/, "")}/prices`);
  if (opts?.force) url.searchParams.set("force", "true");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /prices returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as Partial<PricesData>;
  if (
    typeof data.fetchedAt !== "number" ||
    typeof data.quotes !== "object" ||
    data.quotes === null
  ) {
    throw new Error("Bridge /prices response missing 'quotes' / 'fetchedAt'");
  }
  return {
    quotes: data.quotes as Quotes,
    fetchedAt: data.fetchedAt,
    stale: Boolean(data.stale),
  };
}

export async function deleteHolding(id: string): Promise<void> {
  const baseUrl = requireEnv("BRIDGE_URL");
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const res = await fetch(
    `${baseUrl.replace(/\/$/, "")}/holdings/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      // non-JSON body; keep the raw text
    }
    throw new BridgeHoldingsError(res.status, message);
  }
}
