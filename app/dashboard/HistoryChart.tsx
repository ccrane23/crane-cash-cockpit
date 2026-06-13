import type { HistorySeries } from "@/lib/finance";
import { OTHER_CATEGORY_ID } from "@/lib/finance";
import { formatMonthLabel, formatCurrencyWhole } from "@/lib/format";

// Muted, editorial categorical palette. Index aligns to series.categories;
// "Other" always renders in the neutral tail color regardless of its index.
const PALETTE = [
  "#c9a96e", // gold
  "#14a89e", // teal
  "#5b8fb0", // slate blue
  "#b0859e", // mauve
  "#9fb07a", // sage
  "#cf8a5c", // amber
];
const OTHER_COLOR = "#4a4a4a";

function colorFor(categoryId: string, index: number): string {
  if (categoryId === OTHER_CATEGORY_ID) return OTHER_COLOR;
  return PALETTE[index % PALETTE.length];
}

export default function HistoryChart({
  series,
  onSelectCategory,
}: {
  series: HistorySeries;
  onSelectCategory?: (categoryId: string, category: string) => void;
}) {
  const max = Math.max(...series.months.map((m) => m.total), 1);
  const hasData = series.months.some((m) => m.total > 0);

  if (!hasData) {
    return (
      <p className="bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-secondary)]">
        No spending history for this window.
      </p>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] p-5">
      {/* Legend */}
      <div className="mb-5 flex flex-wrap gap-x-4 gap-y-2">
        {series.categories.map((c, i) => {
          const drillable =
            onSelectCategory && c.categoryId !== OTHER_CATEGORY_ID;
          return (
            <button
              key={c.categoryId || c.category}
              type="button"
              onClick={
                drillable
                  ? () => onSelectCategory!(c.categoryId, c.category)
                  : undefined
              }
              className={`flex items-center gap-2 text-xs ${
                drillable ? "hover:text-[var(--color-text)]" : "cursor-default"
              } text-[var(--color-text-secondary)] focus:outline-none`}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: colorFor(c.categoryId, i) }}
              />
              {c.category}
            </button>
          );
        })}
      </div>

      {/* Bars */}
      <div className="flex h-56 items-end gap-1.5">
        {series.months.map((m) => (
          <div key={m.month} className="flex h-full flex-1 flex-col justify-end">
            <div
              className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
              style={{ height: `${(m.total / max) * 100}%` }}
              title={`${formatMonthLabel(m.month)} · ${formatCurrencyWhole(m.total)}`}
            >
              {m.values.map((v, i) => {
                if (v <= 0) return null;
                const cat = series.categories[i];
                return (
                  <div
                    key={cat.categoryId || cat.category}
                    style={{
                      height: `${(v / m.total) * 100}%`,
                      background: colorFor(cat.categoryId, i),
                    }}
                    title={`${cat.category} · ${formatMonthLabel(m.month)} · ${formatCurrencyWhole(v)}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* X axis */}
      <div className="mt-2 flex gap-1.5">
        {series.months.map((m) => (
          <span
            key={m.month}
            className="flex-1 text-center text-[10px] tabular-nums text-[var(--color-text-tertiary)]"
            translate="no"
          >
            {formatMonthLabel(m.month)}
          </span>
        ))}
      </div>
    </div>
  );
}
