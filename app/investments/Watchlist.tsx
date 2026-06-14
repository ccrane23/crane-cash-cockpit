"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import type { PricesData } from "@/lib/holdings";
import type { WatchlistData, WatchlistEntry } from "@/lib/watchlist";

// Zone bounds render without forced cents ("$370", "$63.5") to stay readable.
const zoneFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatZone(low: number | null, high: number | null): string {
  if (low === null && high === null) return "No set zone";
  if (low !== null && high !== null)
    return `${zoneFmt.format(low)}–${zoneFmt.format(high)}`;
  if (low !== null) return `≥ ${zoneFmt.format(low)}`;
  return `≤ ${zoneFmt.format(high as number)}`;
}

type ZoneStatus = "below" | "in" | "above" | null;

// null status = no badge: either no zone is set (space ETFs) or we have no live
// price to compare against.
function zoneStatus(
  price: number | null,
  low: number | null,
  high: number | null,
): ZoneStatus {
  if (low === null && high === null) return null;
  if (price === null) return null;
  if (low !== null && price < low) return "below";
  if (high !== null && price > high) return "above";
  return "in";
}

// "" → null (no bound); a non-number → undefined (invalid, caller rejects).
function parseZoneInput(s: string): number | null | undefined {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const inputClass =
  "w-full border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-gold)] tabular-nums";

function StatusBadge({ status }: { status: ZoneStatus }) {
  if (status === null) return null;
  const base =
    "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-wider";
  if (status === "below") {
    return (
      <span className={`${base} border border-[var(--color-positive)] text-[var(--color-positive)]`}>
        Below zone
      </span>
    );
  }
  if (status === "in") {
    // The "act now" signal — brand gold, filled for maximum emphasis.
    return (
      <span className={`${base} bg-[var(--color-gold)] font-medium text-[var(--color-bg)]`}>
        In zone
      </span>
    );
  }
  return (
    <span className={`${base} border border-[var(--color-border)] text-[var(--color-text-tertiary)]`}>
      Above zone
    </span>
  );
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

function PencilIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export default function Watchlist({
  initial,
  initialPrices,
}: {
  initial: WatchlistData;
  initialPrices: PricesData | null;
}) {
  const [entries, setEntries] = useState<WatchlistEntry[]>(initial.entries);
  const [prices, setPrices] = useState<PricesData | null>(initialPrices);
  const [listError, setListError] = useState<string | null>(null);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Inline edit (one card at a time).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLow, setEditLow] = useState("");
  const [editHigh, setEditHigh] = useState("");
  const [editNote, setEditNote] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Add control.
  const [addTicker, setAddTicker] = useState("");
  const [addLow, setAddLow] = useState("");
  const [addHigh, setAddHigh] = useState("");
  const [addNote, setAddNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function quoteFor(ticker: string): number | null {
    return prices?.quotes?.[ticker] ?? null;
  }

  function startEdit(entry: WatchlistEntry) {
    setEditError(null);
    setConfirmId(null);
    setEditingId(entry.id);
    setEditLow(entry.zoneLow === null ? "" : String(entry.zoneLow));
    setEditHigh(entry.zoneHigh === null ? "" : String(entry.zoneHigh));
    setEditNote(entry.note ?? "");
  }

  async function saveEdit(id: string) {
    setEditError(null);
    const low = parseZoneInput(editLow);
    const high = parseZoneInput(editHigh);
    if (low === undefined || high === undefined) {
      return setEditError("Zones must be non-negative numbers or blank.");
    }
    if (low !== null && high !== null && low > high) {
      return setEditError("Low must not exceed high.");
    }

    setSavingId(id);
    try {
      const res = await fetch(`/api/watchlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoneLow: low,
          zoneHigh: high,
          note: editNote.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const { entry } = (await res.json()) as { entry: WatchlistEntry };
      setEntries((prev) => prev.map((e) => (e.id === id ? entry : e)));
      setEditingId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingId(null);
    }
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
    const low = parseZoneInput(addLow);
    const high = parseZoneInput(addHigh);
    if (low === undefined || high === undefined) {
      return setAddError("Zones must be non-negative numbers or blank.");
    }
    if (low !== null && high !== null && low > high) {
      return setAddError("Low must not exceed high.");
    }

    setAdding(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: addTicker.trim().toUpperCase(),
          zoneLow: low,
          zoneHigh: high,
          note: addNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const { entry } = (await res.json()) as { entry: WatchlistEntry };
      setEntries((prev) => [...prev, entry]);

      // A brand-new ticker isn't in the price cache yet; pull quotes so its card
      // gets a live price without a full reload. Best-effort.
      try {
        const pr = await fetch("/api/prices", { cache: "no-store" });
        if (pr.ok) setPrices((await pr.json()) as PricesData);
      } catch {
        // leave prices as-is; the card just shows "—" until next refresh
      }

      setAddTicker("");
      setAddLow("");
      setAddHigh("");
      setAddNote("");
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : "Could not add to watchlist.",
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between px-1">
        <p className="mini-label">Watchlist</p>
        <p className="mini-label">buy zones</p>
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
            const status = zoneStatus(price, e.zoneLow, e.zoneHigh);
            const isEditing = editingId === e.id;

            return (
              <div
                key={e.id}
                className={`flex flex-col gap-3 bg-[var(--color-surface)] p-4 ${
                  status === "in"
                    ? "ring-1 ring-inset ring-[var(--color-gold)]"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[var(--color-text)]">{e.ticker}</p>
                    {e.stale && (
                      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
                        stale — verify
                      </p>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(e)}
                        aria-label={`Edit ${e.ticker} zone`}
                        title="Edit zone"
                        className="text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-gold)]"
                      >
                        <PencilIcon />
                      </button>
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
                          aria-label={`Delete ${e.ticker}`}
                          title="Delete"
                          className="text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-negative)]"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mini-label">Low</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={editLow}
                          onChange={(ev) => setEditLow(ev.target.value)}
                          placeholder="—"
                          className={`mt-1 ${inputClass}`}
                        />
                      </label>
                      <label className="block">
                        <span className="mini-label">High</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={editHigh}
                          onChange={(ev) => setEditHigh(ev.target.value)}
                          placeholder="—"
                          className={`mt-1 ${inputClass}`}
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="mini-label">Note</span>
                      <input
                        value={editNote}
                        onChange={(ev) => setEditNote(ev.target.value)}
                        placeholder="optional"
                        className={`mt-1 ${inputClass}`}
                      />
                    </label>
                    {editError && (
                      <p className="text-xs text-[var(--color-negative)]">
                        {editError}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(e.id)}
                        disabled={savingId === e.id}
                        className="bg-[var(--color-gold)] px-3 py-1.5 text-sm font-medium text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {savingId === e.id ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1.5 text-sm text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-[var(--color-text-tertiary)]">
                          Buy zone
                        </p>
                        <p className="tabular-nums text-[var(--color-text)]">
                          {formatZone(e.zoneLow, e.zoneHigh)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-[var(--color-text-tertiary)]">
                          Price
                        </p>
                        <p className="tabular-nums text-[var(--color-text)]">
                          {price !== null ? formatCurrency(price) : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge status={status} />
                      {e.note && (
                        <p className="truncate text-xs text-[var(--color-text-tertiary)]">
                          {e.note}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <p className="mini-label">Add to watchlist</p>
        </div>
        <div className="bg-[var(--color-surface)] p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
              <span className="mini-label">Zone low</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={addLow}
                onChange={(e) => setAddLow(e.target.value)}
                placeholder="optional"
                className={`mt-2 ${inputClass}`}
              />
            </label>
            <label className="block">
              <span className="mini-label">Zone high</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={addHigh}
                onChange={(e) => setAddHigh(e.target.value)}
                placeholder="optional"
                className={`mt-2 ${inputClass}`}
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
            <p className="mt-4 text-sm text-[var(--color-negative)]">
              {addError}
            </p>
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
