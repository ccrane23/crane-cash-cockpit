"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import type { PricesData } from "@/lib/holdings";
import type { WatchlistData, WatchlistEntry } from "@/lib/watchlist";
import type { Signal, SignalsData } from "@/lib/signals";

// Compact currency (no forced cents) for 52-week bounds and targets.
const moneyShort = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const inputClass =
  "w-full border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-gold)] tabular-nums";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// RSI tone: ≤30 oversold (opportunity, teal), ≥70 overbought (red), else neutral.
function rsiTone(rsi: number): { label: string; color: string } {
  if (rsi <= 30) return { label: "oversold", color: "var(--color-positive)" };
  if (rsi >= 70) return { label: "overbought", color: "var(--color-negative)" };
  return { label: "neutral", color: "var(--color-text-secondary)" };
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

// Price vs a moving average: directional arrow + distance, colored by direction.
function MaCell({ label, price, ma }: { label: string; price: number | null; ma: number | null }) {
  let body = <span className="text-[var(--color-text-tertiary)]">—</span>;
  if (price !== null && ma !== null && ma > 0) {
    const diff = ((price - ma) / ma) * 100;
    const above = price >= ma;
    body = (
      <span
        className="tabular-nums"
        style={{ color: above ? "var(--color-positive)" : "var(--color-negative)" }}
        title={`Price vs ${label} SMA (${formatCurrency(ma)})`}
      >
        {above ? "▲" : "▼"} {signedPct(diff)}
      </span>
    );
  }
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </p>
      <p className="text-xs">{body}</p>
    </div>
  );
}

// Informational "read": how many simple signals lean toward a reasonable entry.
// NOT advice — just a count of below-200DMA, RSI under 40, and below mean target.
function entryRead(
  price: number | null,
  s: Signal,
): { count: number; total: number } {
  let count = 0;
  let total = 0;
  if (price !== null && s.ma200 !== null) {
    total++;
    if (price < s.ma200) count++;
  }
  if (s.rsi14 !== null) {
    total++;
    if (s.rsi14 < 40) count++;
  }
  if (price !== null && s.priceTarget?.mean != null) {
    total++;
    if (price < s.priceTarget.mean) count++;
  }
  return { count, total };
}

export default function Watchlist({
  initial,
  initialPrices,
  initialSignals,
}: {
  initial: WatchlistData;
  initialPrices: PricesData | null;
  initialSignals: SignalsData | null;
}) {
  const [entries, setEntries] = useState<WatchlistEntry[]>(initial.entries);
  const [prices, setPrices] = useState<PricesData | null>(initialPrices);
  const [signals, setSignals] = useState<SignalsData | null>(initialSignals);
  const [listError, setListError] = useState<string | null>(null);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add control.
  const [addTicker, setAddTicker] = useState("");
  const [addNote, setAddNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function quoteFor(ticker: string): number | null {
    return prices?.quotes?.[ticker] ?? null;
  }
  function signalFor(ticker: string): Signal | null {
    return signals?.signals?.[ticker] ?? null;
  }

  async function doDelete(id: string) {
    setDeletingId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Delete failed (${res.status})`);
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Could not delete the entry.",
      );
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  async function addEntry() {
    setAddError(null);
    if (!addTicker.trim()) return setAddError("Ticker is required.");

    setAdding(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: addTicker.trim().toUpperCase(),
          note: addNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const { entry } = (await res.json()) as { entry: WatchlistEntry };
      setEntries((prev) => [...prev, entry]);

      // Pull price + signals so the new card isn't blank. Best-effort; signals
      // may take a moment to compute on a cold cache.
      try {
        const pr = await fetch("/api/prices", { cache: "no-store" });
        if (pr.ok) setPrices((await pr.json()) as PricesData);
      } catch {
        /* leave prices as-is */
      }
      try {
        const sr = await fetch("/api/signals", { cache: "no-store" });
        if (sr.ok) setSignals((await sr.json()) as SignalsData);
      } catch {
        /* leave signals as-is */
      }

      setAddTicker("");
      setAddNote("");
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : "Could not add to watchlist.",
      );
    } finally {
      setAdding(false);
    }
  }

  // Whether any premium-only signal source is confirmed unavailable on our tier.
  const tier = signals?.tier;
  const premiumHidden =
    tier && (tier.candle === false || tier.priceTarget === false);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <p className="mini-label">Watchlist</p>
        <p className="mini-label">signals · not advice</p>
      </div>

      {listError && (
        <p className="mb-px bg-[var(--color-surface)] px-5 py-3 text-sm text-[var(--color-negative)]">
          {listError}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="bg-[var(--color-surface)] px-5 py-4 text-sm text-[var(--color-text-tertiary)]">
          Nothing on the watchlist yet. Add a ticker below.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-px bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((e) => {
            const price = quoteFor(e.ticker);
            const s = signalFor(e.ticker);

            // 52-week range position (0 = at low, 100 = at high).
            let pos52: number | null = null;
            if (
              price !== null &&
              s?.high52 != null &&
              s?.low52 != null &&
              s.high52 > s.low52
            ) {
              pos52 = clamp(((price - s.low52) / (s.high52 - s.low52)) * 100, 0, 100);
            }

            const read = s ? entryRead(price, s) : { count: 0, total: 0 };
            const leaningEntry = read.total >= 2 && read.count >= 2;

            const tone = s?.rsi14 != null ? rsiTone(s.rsi14) : null;

            const target = s?.priceTarget?.mean ?? null;
            const upside =
              target !== null && price !== null && price > 0
                ? ((target - price) / price) * 100
                : null;

            return (
              <div
                key={e.id}
                className="flex flex-col gap-3 bg-[var(--color-surface)] p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-[var(--color-text)]">
                    {e.ticker}
                    {s?.name && (
                      <span className="text-[var(--color-text-tertiary)]">
                        {" — "}
                        {s.name}
                      </span>
                    )}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {confirmId === e.id ? (
                      <span className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => doDelete(e.id)}
                          disabled={deletingId === e.id}
                          className="text-[var(--color-negative)] transition-opacity hover:opacity-80 disabled:opacity-40"
                        >
                          {deletingId === e.id ? "…" : "Yes"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setListError(null);
                          setConfirmId(e.id);
                        }}
                        aria-label={`Remove ${e.ticker}`}
                        title="Remove from watchlist"
                        className="text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-negative)]"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                      Price
                    </p>
                    <p className="text-lg tabular-nums text-[var(--color-text)]">
                      {price !== null ? formatCurrency(price) : "—"}
                    </p>
                  </div>
                  {leaningEntry && (
                    <span
                      className="inline-flex items-center bg-[var(--color-gold)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-bg)]"
                      title={`${read.count} of ${read.total} entry signals: below 200-day, RSI < 40, below mean target`}
                    >
                      Leaning entry
                    </span>
                  )}
                </div>

                {/* 52-week range */}
                <div>
                  <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                    <span>52-week</span>
                    <span className="tabular-nums">
                      {pos52 !== null ? `${Math.round(pos52)}%` : "—"}
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden bg-[var(--color-bg)]">
                    {pos52 !== null && (
                      <div
                        className="h-full bg-[var(--color-gold)]"
                        style={{ width: `${pos52}%` }}
                      />
                    )}
                  </div>
                  <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-[var(--color-text-tertiary)]">
                    <span>{s?.low52 != null ? moneyShort.format(s.low52) : "—"}</span>
                    <span>{s?.high52 != null ? moneyShort.format(s.high52) : "—"}</span>
                  </div>
                </div>

                {/* Moving averages + RSI */}
                <div className="grid grid-cols-3 gap-2">
                  <MaCell label="50D" price={price} ma={s?.ma50 ?? null} />
                  <MaCell label="200D" price={price} ma={s?.ma200 ?? null} />
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                      RSI 14
                    </p>
                    <p className="text-xs tabular-nums" style={{ color: tone?.color }}>
                      {s?.rsi14 != null ? `${s.rsi14.toFixed(0)}` : "—"}
                      {tone && (
                        <span className="text-[10px]"> · {tone.label}</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Analyst consensus (if our tier exposes it) */}
                {(s?.priceTarget?.mean != null || s?.recommendation?.label) && (
                  <div className="flex items-end justify-between gap-2 border-t border-[var(--color-border)] pt-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                        Avg target
                      </p>
                      <p className="text-xs tabular-nums text-[var(--color-text)]">
                        {target !== null ? moneyShort.format(target) : "—"}
                        {upside !== null && (
                          <span
                            style={{
                              color:
                                upside >= 0
                                  ? "var(--color-positive)"
                                  : "var(--color-negative)",
                            }}
                          >
                            {" "}
                            {signedPct(upside)}
                          </span>
                        )}
                      </p>
                    </div>
                    {s?.recommendation?.label && (
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                          Analysts
                        </p>
                        <p className="text-xs text-[var(--color-text-secondary)]">
                          {s.recommendation.label}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {e.note && (
                  <p className="truncate text-xs text-[var(--color-text-tertiary)]">
                    {e.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {premiumHidden && (
        <p className="mt-2 px-1 text-[10px] text-[var(--color-text-tertiary)]">
          Some signals (moving averages, RSI, and/or analyst targets) require a
          paid Finnhub plan and are hidden on the current tier.
        </p>
      )}

      <div className="mt-6">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="mini-label">Add to watchlist</p>
        </div>
        <div className="bg-[var(--color-surface)] p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mini-label">Ticker</span>
              <input
                value={addTicker}
                onChange={(e) => setAddTicker(e.target.value)}
                placeholder="AAPL"
                autoCapitalize="characters"
                className={`mt-2 ${inputClass} uppercase`}
              />
            </label>
            <label className="block">
              <span className="mini-label">Note (optional)</span>
              <input
                value={addNote}
                onChange={(e) => setAddNote(e.target.value)}
                placeholder="thesis"
                className={`mt-2 ${inputClass}`}
              />
            </label>
          </div>

          {addError && (
            <p className="mt-4 text-sm text-[var(--color-negative)]">{addError}</p>
          )}

          <button
            type="button"
            onClick={addEntry}
            disabled={adding}
            className="mt-5 bg-[var(--color-gold)] px-4 py-2 font-medium text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {adding ? "Adding…" : "Add to watchlist"}
          </button>
        </div>
      </div>
    </section>
  );
}
