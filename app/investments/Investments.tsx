"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import TickerAutocomplete from "./TickerAutocomplete";
import { formatCurrency, balanceColor } from "@/lib/format";
import type {
  HoldingsData,
  PricesData,
  Lot,
  TickerRollup,
} from "@/lib/holdings";
import type { SignalsData } from "@/lib/signals";

const sharesFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
function formatShares(n: number): string {
  return sharesFmt.format(n);
}

// Wall-clock for the "prices as of" label. Only ever rendered after mount (see
// `mounted`), so server/client timezone differences can't cause a hydration
// mismatch.
const clockFmt = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
function formatClock(ms: number): string {
  return clockFmt.format(ms);
}

// Hydration-safe "are we on the client yet?" — false during SSR and the initial
// hydration pass, true thereafter. Lets us defer timezone-dependent clock
// formatting to the client without a mismatch (and without setState-in-effect).
const subscribeNoop = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

// Local YYYY-MM-DD for the date input's default (browser-local, no TZ math past
// the offset shift). This runs only in the browser, so the real clock is fine.
function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const inputClass =
  "w-full border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-gold)] tabular-nums";

// A ticker rollup enriched with live price and P&L. Basis-incomplete positions
// (gifted shares with unknown cost) carry a market value but null gain — we
// don't fabricate a cost to subtract against. See `buildPositions`.
type Position = TickerRollup & {
  price: number | null;
  currentValue: number | null;
  gain: number | null;
  gainPct: number | null;
};

function buildPositions(
  rollups: TickerRollup[],
  quotes: PricesData["quotes"] | null,
): Position[] {
  return rollups.map((r) => {
    const price = quotes?.[r.ticker] ?? null;
    const currentValue = price !== null ? r.totalShares * price : null;

    // P&L only where the cost basis is complete. A ticker holding gifted
    // (basisUnknown) shares has an incomplete basis, so gain is left null and
    // shown as "n/a" rather than understating the loss against a $0 placeholder.
    let gain: number | null = null;
    let gainPct: number | null = null;
    if (r.basisUnknownShares === 0 && price !== null && currentValue !== null) {
      gain = currentValue - r.totalCostBasis;
      gainPct = r.totalCostBasis > 0 ? (gain / r.totalCostBasis) * 100 : null;
    }

    return { ...r, price, currentValue, gain, gainPct };
  });
}

function gainLabel(p: Position): string {
  if (p.basisUnknownShares > 0) return "P&L n/a";
  if (p.gain === null) return "—";
  const dollars = `${p.gain >= 0 ? "+" : ""}${formatCurrency(p.gain)}`;
  if (p.gainPct === null) return dollars;
  return `${dollars} (${p.gain >= 0 ? "+" : ""}${p.gainPct.toFixed(1)}%)`;
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

export default function Investments({
  initial,
  initialPrices,
  signals,
}: {
  initial: HoldingsData;
  initialPrices: PricesData | null;
  signals: SignalsData | null;
}) {
  const [data, setData] = useState<HoldingsData>(initial);
  const [prices, setPrices] = useState<PricesData | null>(initialPrices);
  const mounted = useMounted();

  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add-purchase form.
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const positions = useMemo(
    () => buildPositions(data.rollups, prices?.quotes ?? null),
    [data.rollups, prices],
  );

  // Lots grouped under their ticker, oldest first, so each position can list the
  // individual lots that compose it (and let one be deleted).
  const lotsByTicker = useMemo(() => {
    const map = new Map<string, Lot[]>();
    for (const lot of data.lots) {
      const arr = map.get(lot.ticker) ?? [];
      arr.push(lot);
      map.set(lot.ticker, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.purchaseDate < b.purchaseDate ? -1 : 1));
    }
    return map;
  }, [data.lots]);

  // Portfolio totals over the positions we can actually price / value.
  const priced = positions.filter((p) => p.currentValue !== null);
  const marketValue = priced.reduce((s, p) => s + (p.currentValue ?? 0), 0);
  const gainable = positions.filter((p) => p.gain !== null);
  const totalGain = gainable.reduce((s, p) => s + (p.gain ?? 0), 0);
  const totalGainBasis = gainable.reduce((s, p) => s + p.totalCostBasis, 0);
  const totalGainPct =
    totalGainBasis > 0 ? (totalGain / totalGainBasis) * 100 : null;

  async function refetchHoldings() {
    const res = await fetch("/api/holdings", { cache: "no-store" });
    if (res.ok) setData((await res.json()) as HoldingsData);
  }

  async function loadPrices(force: boolean) {
    const res = await fetch(`/api/prices${force ? "?force=true" : ""}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Prices request failed (${res.status})`);
    setPrices((await res.json()) as PricesData);
  }

  async function refreshPrices() {
    setRefreshing(true);
    setListError(null);
    try {
      await loadPrices(true);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Could not refresh prices.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function doDelete(id: string) {
    setDeletingId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/holdings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Delete failed (${res.status})`);
      }
      await refetchHoldings();
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Could not delete the lot.",
      );
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  async function submit() {
    setFormError(null);

    // Light client-side guard; the bridge is the source of truth and re-validates.
    const sharesNum = Number(shares);
    const priceNum = Number(price);
    if (!ticker.trim()) return setFormError("Ticker is required.");
    if (!Number.isFinite(sharesNum) || sharesNum <= 0) {
      return setFormError("Shares must be a positive number.");
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return setFormError("Price per share must be zero or more.");
    }
    if (!date) return setFormError("Purchase date is required.");

    setSubmitting(true);
    try {
      const res = await fetch("/api/holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          shares: sharesNum,
          pricePerShare: priceNum,
          purchaseDate: date,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      // Pull the recomputed rollups back from the bridge so the math stays
      // server-authoritative rather than re-derived here.
      await refetchHoldings();
      // A brand-new ticker won't be in the price cache; pull quotes so it gets
      // a live price without waiting for the manual refresh. Best-effort.
      await loadPrices(false).catch(() => {});

      setTicker("");
      setShares("");
      setPrice("");
      setNote("");
      setDate(todayIso());
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not add the purchase.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const priceStatus =
    prices && prices.fetchedAt > 0
      ? mounted
        ? `Prices as of ${formatClock(prices.fetchedAt)}${prices.stale ? " · cached" : ""}`
        : "Prices …"
      : "Prices unavailable";

  return (
    <div className="flex flex-col gap-px">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <p className="section-label">Holdings</p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {priceStatus}
            </span>
            <button
              type="button"
              onClick={refreshPrices}
              disabled={refreshing}
              className="mini-label text-[var(--color-gold)] transition-opacity hover:opacity-80 disabled:opacity-40"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {priced.length > 0 && (
          <div className="mb-3 rounded-md border border-[var(--color-gold)]/55 bg-[var(--color-surface)] p-5 sm:p-6">
            <div className="flex items-baseline justify-between">
              <p className="mini-label">Market value</p>
              <p className="mini-label">Unrealized P&amp;L</p>
            </div>
            <div className="mt-3 flex items-end justify-between gap-4">
              <p className="text-3xl tabular-nums text-[var(--color-text)] sm:text-4xl">
                {formatCurrency(marketValue)}
              </p>
              <p
                className="text-base tabular-nums sm:text-lg"
                style={{ color: balanceColor(totalGain) }}
              >
                {gainable.length === 0
                  ? "—"
                  : `${totalGain >= 0 ? "+" : ""}${formatCurrency(totalGain)}${
                      totalGainPct !== null
                        ? ` (${totalGain >= 0 ? "+" : ""}${totalGainPct.toFixed(1)}%)`
                        : ""
                    }`}
              </p>
            </div>
          </div>
        )}

        {listError && (
          <p className="mb-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 text-sm text-[var(--color-negative)]">
            {listError}
          </p>
        )}

        <div className="overflow-hidden rounded-md border border-[var(--color-gold)]/55 bg-[var(--color-surface)]">
          {positions.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--color-text-tertiary)]">
              No holdings yet. Add your first purchase below.
            </p>
          ) : (
            positions.map((p) => (
              <div
                key={p.ticker}
                className="border-b border-[var(--color-border)] last:border-b-0"
              >
                <div className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-[var(--color-text)]">
                      {p.ticker}
                      {signals?.signals?.[p.ticker]?.name && (
                        <span className="text-[var(--color-detail)]">
                          {" — "}
                          {signals.signals[p.ticker]?.name}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-[var(--color-detail)]">
                      {formatShares(p.totalShares)} sh
                      {" · "}
                      {p.weightedAvgCost !== null
                        ? `${formatCurrency(p.weightedAvgCost)} avg`
                        : "— avg"}
                      {" · "}
                      {p.price !== null ? `${formatCurrency(p.price)} now` : "— now"}
                    </p>
                    {p.basisUnknownShares > 0 && (
                      <p className="mt-1 text-xs text-[var(--color-gold)]">
                        {formatShares(p.basisUnknownShares)} sh · basis TBD
                        (excluded from P&amp;L)
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular-nums text-[var(--color-text)]">
                      {p.currentValue !== null
                        ? formatCurrency(p.currentValue)
                        : "—"}
                    </p>
                    <p
                      className="mt-1 text-xs tabular-nums"
                      style={{
                        color:
                          p.gain !== null
                            ? balanceColor(p.gain)
                            : "var(--color-text-tertiary)",
                      }}
                    >
                      {gainLabel(p)}
                    </p>
                  </div>
                </div>

                <ul className="border-t border-[var(--color-border)] bg-[var(--color-bg)]">
                  {(lotsByTicker.get(p.ticker) ?? []).map((lot) => (
                    <li
                      key={lot.id}
                      className="flex items-center justify-between gap-3 px-5 py-2 text-xs"
                    >
                      <span className="min-w-0 truncate tabular-nums text-[var(--color-detail)]">
                        {lot.purchaseDate} · {formatShares(lot.shares)} @{" "}
                        {formatCurrency(lot.pricePerShare)}
                        {lot.basisUnknown && (
                          <span className="text-[var(--color-gold)]">
                            {" "}
                            · basis TBD
                          </span>
                        )}
                        {lot.note && (
                          <span className="text-[var(--color-text-tertiary)]">
                            {" "}
                            · {lot.note}
                          </span>
                        )}
                      </span>

                      {confirmId === lot.id ? (
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-[var(--color-text-tertiary)]">
                            Remove?
                          </span>
                          <button
                            type="button"
                            onClick={() => doDelete(lot.id)}
                            disabled={deletingId === lot.id}
                            className="text-[var(--color-negative)] transition-opacity hover:opacity-80 disabled:opacity-40"
                          >
                            {deletingId === lot.id ? "…" : "Yes"}
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
                            setConfirmId(lot.id);
                          }}
                          aria-label={`Delete ${lot.ticker} lot from ${lot.purchaseDate}`}
                          title="Delete lot"
                          className="shrink-0 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-negative)]"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="section-label">Add purchase</p>
        </div>

        <div className="bg-[var(--color-surface)] p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mini-label">Ticker</span>
              <div className="mt-2">
                <TickerAutocomplete
                  value={ticker}
                  onChange={setTicker}
                  placeholder="AAPL"
                  inputClassName={`${inputClass} uppercase`}
                />
              </div>
            </label>

            <label className="block">
              <span className="mini-label">Purchase date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`mt-2 ${inputClass}`}
              />
            </label>

            <label className="block">
              <span className="mini-label">Shares</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                placeholder="10"
                className={`mt-2 ${inputClass}`}
              />
            </label>

            <label className="block">
              <span className="mini-label">Price per share</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="188.51"
                className={`mt-2 ${inputClass}`}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mini-label">Note (optional)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="blended seed"
                className={`mt-2 ${inputClass}`}
              />
            </label>
          </div>

          {formError && (
            <p className="mt-4 text-sm text-[var(--color-negative)]">
              {formError}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="mt-5 bg-[var(--color-gold)] px-4 py-2 font-medium text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "Adding…" : "Add purchase"}
          </button>
        </div>
      </section>
    </div>
  );
}
