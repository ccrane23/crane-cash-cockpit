import type { HistorySeries } from "@/lib/finance";
import { UNCATEGORIZED_GROUP_ID } from "@/lib/finance";
import { formatMonthLabel, formatCurrencyWhole } from "@/lib/format";

// On-brand categorical colors: tints and shades of the gold / teal / cream
// palette only — no new saturated hues. Keyed by group name so a group keeps
// its color as its rank shifts month to month. "Uncategorized" is the neutral
// tail; unknown group names fall back deterministically into the same ramp.
const GROUP_COLORS: Record<string, string> = {
  essentials: "#c9a96e", // gold
  "family & kids": "#14a89e", // teal
  spending: "#ddc59a", // gold — tint
  travel: "#5cc4bd", // teal — tint
  autos: "#a07f4a", // gold — shade
  investments: "#0c6f68", // teal — shade
  fees: "#e8e0d0", // cream
  misc: "#b8ad97", // cream — taupe shade
};
const RAMP = Object.values(GROUP_COLORS);
const UNCATEGORIZED_COLOR = "#4a4a4a";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function colorFor(groupId: string, group: string): string {
  if (groupId === UNCATEGORIZED_GROUP_ID) return UNCATEGORIZED_COLOR;
  const key = group.trim().toLowerCase();
  return GROUP_COLORS[key] ?? RAMP[hash(key) % RAMP.length];
}

export default function HistoryChart({ series }: { series: HistorySeries }) {
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
        {series.groups.map((g) => (
          <span
            key={g.groupId}
            className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: colorFor(g.groupId, g.group) }}
            />
            {g.group}
          </span>
        ))}
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
                const g = series.groups[i];
                return (
                  <div
                    key={g.groupId}
                    style={{
                      height: `${(v / m.total) * 100}%`,
                      background: colorFor(g.groupId, g.group),
                    }}
                    title={`${g.group} · ${formatMonthLabel(m.month)} · ${formatCurrencyWhole(v)}`}
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
