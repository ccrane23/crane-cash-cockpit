import { useState } from "react";
import type { CategoryRow } from "@/lib/finance";
import { formatCurrency } from "@/lib/format";

// Rows arrive sorted by spend (highest first); collapsed we show only this many.
const COLLAPSED_COUNT = 10;

function pct(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 100)}%`;
}

// Spending above the trailing average reads red (over), below reads teal
// (under). Brand-new categories with no baseline stay neutral.
function varianceColor(row: CategoryRow): string {
  if (row.variancePct === null) return "var(--color-text-tertiary)";
  if (row.variance > 0) return "var(--color-negative)";
  if (row.variance < 0) return "var(--color-positive)";
  return "var(--color-text-secondary)";
}

export default function CategoriesTable({
  rows,
  onSelect,
}: {
  rows: CategoryRow[];
  onSelect?: (categoryId: string, category: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return (
      <p className="bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-secondary)]">
        No spending recorded this month.
      </p>
    );
  }

  // Bar width is relative to the largest of actual/baseline across all rows, so
  // bars stay comparable whether or not the list is expanded.
  const max = Math.max(
    ...rows.map((r) => Math.max(r.actual, r.baseline)),
    1,
  );

  const canCollapse = rows.length > COLLAPSED_COUNT;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);

  return (
    <div className="bg-[var(--color-surface)]">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--color-border)] px-5 py-3">
        <span className="mini-label">Category</span>
        <span className="mini-label text-right">Spent · Avg</span>
        <span className="mini-label text-right">Variance</span>
      </div>
      <ul>
        {visible.map((r) => (
          <li key={r.categoryId || r.category}>
            <button
              type="button"
              onClick={
                onSelect ? () => onSelect(r.categoryId, r.category) : undefined
              }
              className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--color-border)] px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-[#1c1c1c] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-gold)]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[var(--color-text)]">
                  {r.category}
                </span>
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg)]">
                  <span
                    className="block h-full"
                    style={{
                      width: `${(r.actual / max) * 100}%`,
                      background: varianceColor(r),
                    }}
                  />
                </span>
              </span>
              <span className="text-right tabular-nums">
                <span className="block text-[var(--color-text)]">
                  {formatCurrency(r.actual)}
                </span>
                <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">
                  {formatCurrency(r.baseline)}
                </span>
              </span>
              <span
                className="w-16 text-right tabular-nums"
                style={{ color: varianceColor(r) }}
              >
                {pct(r.variancePct)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-2 border-t border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[#1c1c1c] hover:text-[var(--color-text)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-gold)]"
        >
          {expanded ? "Show less" : `Show all ${rows.length} categories`}
          <span className="text-[var(--color-text-tertiary)]">
            {expanded ? "▴" : "▾"}
          </span>
        </button>
      )}
    </div>
  );
}
