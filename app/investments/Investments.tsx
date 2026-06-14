"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import type { HoldingsData } from "@/lib/holdings";

const sharesFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
function formatShares(n: number): string {
  return sharesFmt.format(n);
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

export default function Investments({ initial }: { initial: HoldingsData }) {
  const [data, setData] = useState<HoldingsData>(initial);

  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      const refreshed = await fetch("/api/holdings", { cache: "no-store" });
      if (refreshed.ok) {
        setData((await refreshed.json()) as HoldingsData);
      }

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

  return (
    <div className="flex flex-col gap-px">
      <section>
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="mini-label">Holdings</p>
          <p className="mini-label">cost basis</p>
        </div>

        <div className="bg-[var(--color-surface)]">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--color-border)] px-5 py-3">
            <span className="mini-label">Ticker</span>
            <span className="mini-label text-right">Shares · Avg cost</span>
            <span className="mini-label text-right">Cost basis</span>
          </div>

          {data.rollups.length === 0 ? (
            <p className="px-5 py-4 text-sm text-[var(--color-text-tertiary)]">
              No holdings yet. Add your first purchase below.
            </p>
          ) : (
            <ul>
              {data.rollups.map((r) => (
                <li
                  key={r.ticker}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--color-border)] px-5 py-4 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block text-[var(--color-text)]">
                      {r.ticker}
                    </span>
                    {r.basisUnknownShares > 0 && (
                      <span className="mt-1 block text-xs text-[var(--color-gold)]">
                        {formatShares(r.basisUnknownShares)} shares · basis TBD
                      </span>
                    )}
                  </span>

                  <span className="text-right">
                    <span className="block tabular-nums text-[var(--color-text)]">
                      {formatShares(r.totalShares)}
                    </span>
                    <span className="mt-1 block text-xs tabular-nums text-[var(--color-text-tertiary)]">
                      {r.weightedAvgCost === null
                        ? "—"
                        : `${formatCurrency(r.weightedAvgCost)} avg`}
                    </span>
                  </span>

                  <span className="text-right tabular-nums text-[var(--color-text)]">
                    {formatCurrency(r.totalCostBasis)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="mini-label">Add purchase</p>
        </div>

        <div className="bg-[var(--color-surface)] p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mini-label">Ticker</span>
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder="AAPL"
                autoCapitalize="characters"
                className={`mt-2 ${inputClass} uppercase`}
              />
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
