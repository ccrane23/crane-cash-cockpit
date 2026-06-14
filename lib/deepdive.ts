// Server-side client for the bridge's AI deep-dive endpoints. The deep dive is
// the only feature that calls a paid LLM, so it is strictly click-driven and
// cache-gated on the bridge — this client just relays.
//
// Contract (must match actual-bridge/src/deepdive.js):
//   POST {BRIDGE_URL}/deep-dive  body: { ticker }  -> DeepDive
//   GET  {BRIDGE_URL}/deep-dive/stats              -> DeepDiveStats

export type DeepDive = {
  overview: string;
  bull: string[];
  risks: string[];
  signalRead: string;
  cached: boolean; // true when served from the 24h cache (no Anthropic call)
  generatedAt: number; // epoch ms
  monthlyCount: number; // actual Anthropic calls this calendar month
};

export type DeepDiveStats = {
  monthlyCount: number;
  month: string; // YYYY-MM
};

export class BridgeDeepDiveError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BridgeDeepDiveError";
    this.status = status;
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function getDeepDive(ticker: string): Promise<DeepDive> {
  const baseUrl = requireEnv("BRIDGE_URL").replace(/\/$/, "");
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const res = await fetch(`${baseUrl}/deep-dive`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({ ticker }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 500);
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      // non-JSON body; keep the raw text
    }
    throw new BridgeDeepDiveError(res.status, message);
  }

  return (await res.json()) as DeepDive;
}

export async function getDeepDiveStats(): Promise<DeepDiveStats> {
  const baseUrl = requireEnv("BRIDGE_URL").replace(/\/$/, "");
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const res = await fetch(`${baseUrl}/deep-dive/stats`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /deep-dive/stats returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as Partial<DeepDiveStats>;
  return {
    monthlyCount: typeof data.monthlyCount === "number" ? data.monthlyCount : 0,
    month: typeof data.month === "string" ? data.month : "",
  };
}
