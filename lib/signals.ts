// Server-side client for the bridge's /signals endpoint. Mirrors the fetch+Bearer
// pattern in lib/actual.ts. Signals are data-driven (computed from Finnhub on the
// bridge) and cached there ~8h; premium-only fields arrive as null.
//
// Contract (must match actual-bridge/src/signals.js):
//   GET {BRIDGE_URL}/signals  -> { signals: { TICKER: Signal|null }, fetchedAt, tier }

export type Recommendation = {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  period: string | null;
  label: string | null;
};

export type PriceTarget = {
  mean: number | null;
  high: number | null;
  low: number | null;
};

export type EntryRating = "attractive" | "neutral" | "extended";

export type Signal = {
  name: string | null;
  high52: number | null;
  low52: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi14: number | null;
  recommendation: Recommendation | null;
  priceTarget: PriceTarget | null;
  // Computed on the bridge — at-a-glance "should I look at this" for a
  // cost-averaging investor. null when no sub-signals were available to score.
  entryRating: EntryRating | null;
  entryReason: string | null;
};

// Data-source access: null unknown, true works, false premium/denied/bad key.
// metric/recommendation/priceTarget are Finnhub; twelveData is the MA/RSI source.
export type SignalTier = {
  metric: boolean | null;
  recommendation: boolean | null;
  priceTarget: boolean | null;
  twelveData: boolean | null;
};

export type SignalsData = {
  signals: Record<string, Signal | null>;
  fetchedAt: number; // epoch ms (oldest cached entry returned)
  tier: SignalTier;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function getSignals(opts?: { force?: boolean }): Promise<SignalsData> {
  const baseUrl = requireEnv("BRIDGE_URL").replace(/\/$/, "");
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const url = new URL(`${baseUrl}/signals`);
  if (opts?.force) url.searchParams.set("force", "true");

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /signals returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as Partial<SignalsData>;
  if (typeof data.signals !== "object" || data.signals === null) {
    throw new Error("Bridge /signals response missing 'signals'");
  }
  return {
    signals: data.signals as Record<string, Signal | null>,
    fetchedAt: typeof data.fetchedAt === "number" ? data.fetchedAt : 0,
    tier: (data.tier as SignalTier) ?? {
      metric: null,
      recommendation: null,
      priceTarget: null,
      twelveData: null,
    },
  };
}
