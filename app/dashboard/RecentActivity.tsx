import type { Transaction } from "@/lib/actual";
import { formatCurrency, formatDayMonth, balanceColor } from "@/lib/format";

export default function RecentActivity({
  items,
  onSelect,
}: {
  items: Transaction[];
  onSelect?: (tx: Transaction) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-secondary)]">
        No recent activity.
      </p>
    );
  }

  return (
    <ul className="bg-[var(--color-surface)]">
      {items.map((tx) => (
        <li key={tx.id}>
          <button
            type="button"
            onClick={onSelect ? () => onSelect(tx) : undefined}
            className="flex w-full items-baseline justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-[#1c1c1c] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-gold)]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[var(--color-text)]">
                {tx.payee || tx.category || "—"}
                {tx.transfer && (
                  <span className="ml-2 text-[var(--color-text-tertiary)]">
                    transfer
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">
                {tx.category || "Uncategorized"} · {tx.account}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span
                className="block tabular-nums"
                style={{ color: balanceColor(tx.amount) }}
              >
                {formatCurrency(tx.amount)}
              </span>
              <span className="mt-0.5 block text-xs tabular-nums text-[var(--color-text-tertiary)]">
                {formatDayMonth(tx.date)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
