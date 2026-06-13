import type { UpcomingBill } from "@/lib/finance";
import { formatCurrency, formatDayMonth } from "@/lib/format";

export default function UpcomingBills({
  bills,
  onSelect,
}: {
  bills: UpcomingBill[];
  onSelect?: (bill: UpcomingBill) => void;
}) {
  if (bills.length === 0) {
    return (
      <p className="bg-[var(--color-surface)] p-5 text-sm text-[var(--color-text-secondary)]">
        No recurring bills detected yet.
      </p>
    );
  }

  return (
    <ul className="bg-[var(--color-surface)]">
      {bills.map((bill) => (
        <li key={`${bill.payee}-${bill.dueDate}`}>
          <button
            type="button"
            onClick={onSelect ? () => onSelect(bill) : undefined}
            className="flex w-full items-baseline justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-[#1c1c1c] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-gold)]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[var(--color-text)]">
                {bill.payee}
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">
                {bill.category} · seen {bill.occurrences}×
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block tabular-nums text-[var(--color-text)]">
                {formatCurrency(bill.amount)}
              </span>
              <span className="mt-0.5 block text-xs tabular-nums text-[var(--color-gold)]">
                {formatDayMonth(bill.dueDate)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
