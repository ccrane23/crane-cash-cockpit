// Click-to-generate AI deep-dive theses. This is the ONLY feature that calls the
// Anthropic API (a few cents per generation), so it is strictly click-driven and
// cache-gated: a thesis generated for a ticker in the last 24h is returned from
// the file cache WITHOUT calling Anthropic. We also persist a per-calendar-month
// counter of actual API calls for cost visibility.
//
// JSON output: claude-sonnet-4-6 rejects assistant-prefill (the 4.6 family
// removed it → 400), so we force a structured response with the GA
// output_config.format json_schema rather than the prefill trick. We also don't
// send temperature (removed on 4.6 → 400).

import { readFileSync, writeFileSync } from "fs";
import { getSignals } from "./signals.js";
import { getQuotes } from "./prices.js";

const DATA_DIR = process.env.DATA_DIR || "/data";
const CACHE_PATH = DATA_DIR + "/deep-dive-cache.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — the cost control
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 700;

// Thrown for any failure that should surface to the UI as "Deep dive unavailable"
// rather than crashing the bridge.
export class DeepDiveError extends Error {}

// Structured-output schema the model must conform to. (Structured outputs don't
// support min/maxItems, so the 2-3 bullet count is enforced via the prompt.)
const THESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    overview: { type: "string" },
    bull: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    signalRead: { type: "string" },
  },
  required: ["overview", "bull", "risks", "signalRead"],
};

const SYSTEM_PROMPT = `You are a precise equity research assistant. Given a ticker and a snapshot of its current market signals, write a tight, balanced, factual investment thesis for a long-term investor.

Rules:
- Be balanced: present the bull case and the risks fairly; do not cheerlead.
- Be factual and specific; prefer concrete drivers over generic statements.
- No hype, no superlatives, no price predictions, and no buy/sell/hold calls.
- This is informational only and is not financial advice.
- Keep every field tight and scannable — short phrases, not paragraphs.

Return ONLY a JSON object matching the provided schema:
- overview: 2-3 sentences on what the company does and why it is investable.
- bull: 2-3 short bullet strings making the bull case.
- risks: 2-3 short bullet strings on the key risks.
- signalRead: ONE line interpreting the supplied price vs 50/200-day moving averages, RSI, and analyst data — what they collectively suggest about the current entry point. Descriptive, not advice.`;

let cache = null;
function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    cache = { theses: {}, monthly: { month: "", count: 0 } };
  }
  if (!cache.theses) cache.theses = {};
  if (!cache.monthly) cache.monthly = { month: "", count: 0 };
  return cache;
}
function saveCache() {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[bridge] could not persist deep-dive cache:", err.message);
  }
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// Count of actual Anthropic calls this calendar month (0 once the month rolls).
function monthlyCount() {
  const c = loadCache();
  return c.monthly.month === currentMonth() ? c.monthly.count : 0;
}

export function getDeepDiveStats() {
  return { monthlyCount: monthlyCount(), month: currentMonth() };
}

function fmtMoney(n) {
  return n === null || n === undefined ? "n/a" : `$${Number(n).toFixed(2)}`;
}

function relToMa(price, ma) {
  if (price === null || ma === null || ma === undefined || ma === 0) return "n/a";
  const diff = ((price - ma) / ma) * 100;
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}% vs ${fmtMoney(ma)}`;
}

function buildUserPrompt(ticker, name, price, s) {
  const lines = [];
  lines.push(`Ticker: ${ticker}${name ? ` (${name})` : ""}`);
  lines.push(`Current price: ${fmtMoney(price)}`);

  const low = s?.low52 ?? null;
  const high = s?.high52 ?? null;
  let rangeNote = `52-week range: ${fmtMoney(low)} to ${fmtMoney(high)}`;
  if (price !== null && low !== null && high !== null && high > low) {
    rangeNote += ` (${Math.round(((price - low) / (high - low)) * 100)}% of range)`;
  }
  lines.push(rangeNote);

  lines.push(`50-day MA: ${s?.ma50 != null ? relToMa(price, s.ma50) : "n/a"}`);
  lines.push(`200-day MA: ${s?.ma200 != null ? relToMa(price, s.ma200) : "n/a"}`);
  lines.push(`RSI(14): ${s?.rsi14 != null ? Math.round(s.rsi14) : "n/a"}`);

  const rec = s?.recommendation;
  if (rec?.label) {
    lines.push(
      `Analyst consensus: ${rec.label} (${rec.strongBuy + rec.buy} buy / ${rec.hold} hold / ${rec.sell + rec.strongSell} sell)`,
    );
  } else {
    lines.push("Analyst consensus: n/a");
  }
  lines.push(`Average analyst target: ${fmtMoney(s?.priceTarget?.mean ?? null)}`);
  if (s?.entryRating) {
    lines.push(
      `Computed entry rating: ${s.entryRating}${s.entryReason ? ` (${s.entryReason})` : ""}`,
    );
  }

  lines.push("");
  lines.push(
    "Write the thesis now. Base signalRead on the price-vs-MA, RSI, and analyst figures above; if some are n/a, work with what is present.",
  );
  return lines.join("\n");
}

async function callAnthropic(userPrompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new DeepDiveError("ANTHROPIC_API_KEY is not set");

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
        output_config: { format: { type: "json_schema", schema: THESIS_SCHEMA } },
      }),
    });
  } catch (err) {
    throw new DeepDiveError(`Anthropic request failed: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[bridge] Anthropic error", res.status, body.slice(0, 300));
    throw new DeepDiveError(`Anthropic returned ${res.status}`);
  }

  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new DeepDiveError("Model declined to generate a thesis");
  }

  const textBlock = Array.isArray(data.content)
    ? data.content.find((b) => b.type === "text")
    : null;
  const text = textBlock?.text ?? "";

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new DeepDiveError("Model did not return valid JSON");
    parsed = JSON.parse(match[0]);
  }

  return {
    overview: typeof parsed.overview === "string" ? parsed.overview : "",
    bull: Array.isArray(parsed.bull) ? parsed.bull.filter((x) => typeof x === "string") : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.filter((x) => typeof x === "string") : [],
    signalRead: typeof parsed.signalRead === "string" ? parsed.signalRead : "",
  };
}

export async function getDeepDive(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(t)) {
    throw new DeepDiveError("ticker must be a 1-12 character symbol");
  }

  const c = loadCache();
  const existing = c.theses[t];
  // Cache hit within 24h — return WITHOUT calling Anthropic (the cost control).
  if (existing && Date.now() - existing.generatedAt < CACHE_TTL_MS) {
    return {
      ...existing.data,
      cached: true,
      generatedAt: existing.generatedAt,
      monthlyCount: monthlyCount(),
    };
  }

  // Gather the signals we already compute for this ticker (bridge-cached, cheap).
  let sig = null;
  let name = null;
  let price = null;
  try {
    const { signals } = await getSignals([t]);
    sig = signals[t] || null;
    name = sig?.name ?? null;
  } catch (err) {
    console.error("[bridge] deep-dive could not load signals:", err.message);
  }
  try {
    const { quotes } = await getQuotes([t]);
    price = quotes[t] ?? null;
  } catch (err) {
    console.error("[bridge] deep-dive could not load price:", err.message);
  }

  const data = await callAnthropic(buildUserPrompt(t, name, price, sig));

  // Only after a successful generation: bump the monthly counter and cache.
  const month = currentMonth();
  if (c.monthly.month !== month) c.monthly = { month, count: 0 };
  c.monthly.count += 1;
  const generatedAt = Date.now();
  c.theses[t] = { generatedAt, data };
  saveCache();

  return { ...data, cached: false, generatedAt, monthlyCount: c.monthly.count };
}
