// Server-side client for the bridge's /symbol-search endpoint. Mirrors the
// fetch+Bearer pattern in lib/holdings.ts. Powers the add-stock autocomplete.
//
// Contract (must match actual-bridge/src/symbolsearch.js):
//   GET {BRIDGE_URL}/symbol-search?q=QUERY  Authorization: Bearer {token}
//   200 -> { results: SymbolMatch[] }   (already US-equity filtered + capped)
//
// The bridge already degrades any upstream failure to an empty list, so a happy
// path is the common case here.

export type SymbolMatch = {
  symbol: string;
  description: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function searchSymbols(query: string): Promise<SymbolMatch[]> {
  const q = query.trim();
  if (!q) return [];

  const baseUrl = requireEnv("BRIDGE_URL");
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const url = new URL(`${baseUrl.replace(/\/$/, "")}/symbol-search`);
  url.searchParams.set("q", q);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /symbol-search returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as { results?: unknown };
  if (!Array.isArray(data.results)) return [];
  // Trust the bridge's shape but guard the fields defensively.
  return data.results
    .map((r) => {
      const row = r as Partial<SymbolMatch>;
      return {
        symbol: String(row.symbol ?? ""),
        description: String(row.description ?? ""),
      };
    })
    .filter((r) => r.symbol && r.description);
}
