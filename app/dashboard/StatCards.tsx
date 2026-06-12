import type { Summary } from "@/lib/finance";
import { formatCurrencyWhole, balanceColor } from "@/lib/format";

export type StatKey = "cash" | "spent" | "income" | "net";

type Card = {
  key: StatKey;
  label: string;
  value: number | null;
  color: string;
  hint: string;
};

function cards(summary: Summary): Card[] {
  return [
    {
      key: "cash",
      label: "Cash Position",
      value: summary.cashPosition,
      color: "var(--color-gold)",
      hint:
        summary.cashPosition === null
          ? "Accounts unavailable"
          : "On-budget accounts",
    },
    {
      key: "spent",
      label: "Spent MTD",
      value: summary.spentMTD,
      color: "var(--color-negative)",
      hint: "Outflows this month",
    },
    {
      key: "income",
      label: "Income MTD",
      value: summary.incomeMTD,
      color: "var(--color-positive)",
      hint: "Inflows this month",
    },
    {
      key: "net",
      label: "Net Flow MTD",
      value: summary.netMTD,
      color: balanceColor(summary.netMTD),
      hint: "Income − spend",
    },
  ];
}

export default function StatCards({
  summary,
  onSelect,
}: {
  summary: Summary;
  onSelect?: (key: StatKey) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-px bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-4">
      {cards(summary).map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={onSelect ? () => onSelect(c.key) : undefined}
          className="group flex flex-col gap-3 bg-[var(--color-surface)] p-5 text-left transition-colors hover:bg-[#1c1c1c] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-gold)]"
        >
          <span className="mini-label flex items-center justify-between">
            {c.label}
            <span className="text-[var(--color-text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100">
              ↗
            </span>
          </span>
          <span
            className="text-2xl tabular-nums sm:text-[1.75rem]"
            style={{ color: c.value === null ? "var(--color-text-tertiary)" : c.color }}
          >
            {c.value === null ? "—" : formatCurrencyWhole(c.value)}
          </span>
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {c.hint}
          </span>
        </button>
      ))}
    </div>
  );
}
