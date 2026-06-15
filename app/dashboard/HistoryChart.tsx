"use client";

import { useState } from "react";
import type { HistorySeries } from "@/lib/finance";
import { formatMonthLabel, formatCurrencyWhole } from "@/lib/format";

// Plot inset (percent of the box) so the first/last points and their labels
// don't clip at the edges.
const PAD = 6;

// Compact dollar label for the trend line: "$2.1k" / "$840".
function abbrevMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `$${Math.round(n)}`;
}

export default function HistoryChart({ series }: { series: HistorySeries }) {
  const [selected, setSelected] = useState<string | null>(null);
  const months = series.months;
  const hasData = months.some((m) => m.total > 0);

  if (!hasData) {
    return (
      <p className="bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-secondary)]">
        No spending history for this window.
      </p>
    );
  }

  const max = Math.max(...months.map((m) => m.total), 1);
  const n = months.length;
  // 0..100 plot box; lower y = higher spend. Headroom at top for value labels.
  const xAt = (i: number) =>
    n > 1 ? PAD + (i / (n - 1)) * (100 - 2 * PAD) : 50;
  const yAt = (total: number) => 90 - (total / max) * 74; // 16..90
  const points = months.map((m, i) => `${xAt(i)},${yAt(m.total)}`).join(" ");

  const selectedMonth = selected
    ? (months.find((m) => m.month === selected) ?? null)
    : null;

  function toggle(month: string) {
    setSelected((cur) => (cur === month ? null : month));
  }

  return (
    <div className="bg-[var(--color-surface)] p-5">
      {/* Scrolls horizontally on narrow screens so 12 months stay readable. */}
      <div className="overflow-x-auto">
        <div className="w-full" style={{ minWidth: n * 56 }}>
          {/* Trend line */}
          <div className="relative h-44">
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              <polyline
                points={points}
                fill="none"
                stroke="var(--color-brand)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {/* Dots + value labels as HTML so they don't distort with the
                stretched (preserveAspectRatio=none) SVG. */}
            {months.map((m, i) => {
              const isSel = m.month === selected;
              return (
                <div
                  key={m.month}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${xAt(i)}%`, top: `${yAt(m.total)}%` }}
                >
                  <span
                    className="block rounded-full"
                    style={{
                      width: isSel ? 9 : 6,
                      height: isSel ? 9 : 6,
                      background: "var(--color-brand)",
                      boxShadow: isSel
                        ? "0 0 0 3px rgba(28,158,109,0.25)"
                        : "none",
                    }}
                  />
                  <span
                    className="absolute left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap text-[9px] tabular-nums"
                    style={{
                      top: -4,
                      color: isSel
                        ? "var(--color-brand)"
                        : "var(--color-detail)",
                    }}
                    translate="no"
                  >
                    {abbrevMoney(m.total)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* X axis — each month tappable to expand its breakdown */}
          <div className="mt-2 flex gap-1">
            {months.map((m) => {
              const isSel = m.month === selected;
              return (
                <button
                  key={m.month}
                  type="button"
                  onClick={() => toggle(m.month)}
                  aria-pressed={isSel}
                  className={`flex-1 rounded py-1 text-center text-[10px] tabular-nums transition-colors ${
                    isSel
                      ? "font-semibold text-[var(--color-brand)]"
                      : "text-[var(--color-text-tertiary)] hover:text-[var(--color-detail)]"
                  }`}
                  translate="no"
                >
                  {formatMonthLabel(m.month)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* On-demand category breakdown for the tapped month */}
      {selectedMonth ? (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <div className="flex items-baseline justify-between">
            <p className="section-label">
              {formatMonthLabel(selectedMonth.month)}
            </p>
            <p className="text-sm tabular-nums text-[var(--color-text)]">
              {formatCurrencyWhole(selectedMonth.total)}
            </p>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {series.groups
              .map((g, i) => ({
                group: g.group,
                groupId: g.groupId,
                value: selectedMonth.values[i] ?? 0,
              }))
              .filter((r) => r.value > 0)
              .sort((a, b) => b.value - a.value)
              .map((r) => (
                <li key={r.groupId} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-[var(--color-detail)]">
                    {r.group}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-bg)]">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(r.value / selectedMonth.total) * 100}%`,
                        background: "var(--color-brand)",
                      }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-secondary)]">
                    {formatCurrencyWhole(r.value)}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[10px] text-[var(--color-text-tertiary)]">
          Tap a month to see its category breakdown.
        </p>
      )}
    </div>
  );
}
