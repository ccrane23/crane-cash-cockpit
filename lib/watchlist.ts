// Server-side client for the bridge's watchlist store. Mirrors the fetch+Bearer
// pattern in lib/actual.ts / lib/holdings.ts.
//
// Contract (must match actual-bridge/src/watchlist.js):
//   GET    {BRIDGE_URL}/watchlist        -> { entries: WatchlistEntry[] }
//   POST   {BRIDGE_URL}/watchlist        body: NewWatchlistInput   -> { entry }
//   PATCH  {BRIDGE_URL}/watchlist/:id    body: WatchlistPatch      -> { entry }
//   DELETE {BRIDGE_URL}/watchlist/:id                              -> { ok }
//   400 -> { error }  (validation)   404 -> { error }  (unknown id)

export type WatchlistEntry = {
  id: string;
  ticker: string;
  zoneLow: number | null;
  zoneHigh: number | null;
  note: string;
  stale: boolean;
};

export type WatchlistData = {
  entries: WatchlistEntry[];
};

export type NewWatchlistInput = {
  ticker: string;
  zoneLow?: number | null;
  zoneHigh?: number | null;
  note?: string;
};

export type WatchlistPatch = {
  ticker?: string;
  zoneLow?: number | null;
  zoneHigh?: number | null;
  note?: string;
};

// Carries the bridge's HTTP status so the API route can relay a 400 (validation)
// or 404 (unknown id) instead of collapsing everything into a 502.
export class BridgeWatchlistError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BridgeWatchlistError";
    this.status = status;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function bridge(): { baseUrl: string; token: string } {
  return {
    baseUrl: requireEnv("BRIDGE_URL").replace(/\/$/, ""),
    token: requireEnv("BRIDGE_BEARER_TOKEN"),
  };
}

// Extract the bridge's `{ error }` message (falling back to the raw body) and
// wrap it with the status for the proxy route to relay.
async function asBridgeError(res: Response): Promise<BridgeWatchlistError> {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 500);
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) message = parsed.error;
  } catch {
    // non-JSON body; keep the raw text
  }
  return new BridgeWatchlistError(res.status, message);
}

export async function getWatchlist(): Promise<WatchlistData> {
  const { baseUrl, token } = bridge();

  const res = await fetch(`${baseUrl}/watchlist`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /watchlist returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as Partial<WatchlistData>;
  if (!Array.isArray(data.entries)) {
    throw new Error("Bridge /watchlist response missing 'entries' array");
  }
  return { entries: data.entries };
}

export async function addWatchlistEntry(
  input: NewWatchlistInput,
): Promise<WatchlistEntry> {
  const { baseUrl, token } = bridge();

  const res = await fetch(`${baseUrl}/watchlist`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(input),
  });

  if (!res.ok) throw await asBridgeError(res);

  const data = (await res.json()) as { entry?: WatchlistEntry };
  if (!data.entry) {
    throw new Error("Bridge POST /watchlist response missing 'entry'");
  }
  return data.entry;
}

export async function updateWatchlistEntry(
  id: string,
  patch: WatchlistPatch,
): Promise<WatchlistEntry> {
  const { baseUrl, token } = bridge();

  const res = await fetch(`${baseUrl}/watchlist/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(patch),
  });

  if (!res.ok) throw await asBridgeError(res);

  const data = (await res.json()) as { entry?: WatchlistEntry };
  if (!data.entry) {
    throw new Error("Bridge PATCH /watchlist response missing 'entry'");
  }
  return data.entry;
}

export async function deleteWatchlistEntry(id: string): Promise<void> {
  const { baseUrl, token } = bridge();

  const res = await fetch(`${baseUrl}/watchlist/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) throw await asBridgeError(res);
}
