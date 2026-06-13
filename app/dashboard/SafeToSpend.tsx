import type { SafeToSpend as SafeToSpendData } from "@/lib/safe-to-spend";
import { BILLS } from "@/lib/safe-to-spend";
import { formatCurrency, formatDayMonth } from "@/lib/format";

// Pay-period day ranges, for the header label.
const RANGE: Record<SafeToSpendData["bucket"], string> = {
  A: "3rd – 17th",
  B: "18th – 2nd",
};

function countdown(days: number): string {
  if (days <= 0) return "Today";
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

export default function SafeToSpend({ data }: { data: SafeToSpendData }) {
  const {
    bucket,
    tdBalance,
    billsStillDue,
    billsRemainingTotal,
    safeToSpend,
    nextPayday,
    daysUntilPayday,
  } = data;

  const bucketBills = BILLS.filter((b) => b.bucket === bucket);
  const dueNames = new Set(billsStillDue.map((b) => b.name));
  const cleared = bucketBills.filter((b) => !dueNames.has(b.name));
  const clearedTotal = cleared.reduce((s, b) => s + b.amount, 0);

  const headlineColor =
    safeToSpend >= 0 ? "var(--color-positive)" : "var(--color-negative)";

  return (
    <div className="bg-[var(--color-surface)] p-5 sm:p-6">
      <div className="flex items-baseline justify-between">
        <p className="mini-label">Pay period {bucket}</p>
        <p className="mini-label">{RANGE[bucket]}</p>
      </div>

      {/* Headline */}
      <p
        className="mt-3 text-4xl tabular-nums sm:text-5xl"
        style={{ color: headlineColor }}
      >
        {formatCurrency(safeToSpend)}
      </p>
      <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
        TD checking {formatCurrency(tdBalance)} − {formatCurrency(billsRemainingTotal)} bills
        still due
      </p>

      {/* Stat row */}
      <div className="mt-5 grid grid-cols-1 gap-px bg-[var(--color-border)] sm:grid-cols-3">
        <Stat label="TD Checking" value={formatCurrency(tdBalance)} hint="…8793" />
        <Stat
          label="Bills Still Due"
          value={formatCurrency(billsRemainingTotal)}
          hint={`${billsStillDue.length} of ${bucketBills.length} remaining`}
        />
        <Stat
          label="Next Paycheck"
          value={countdown(daysUntilPayday)}
          hint={formatDayMonth(nextPayday)}
        />
      </div>

      {/* Bills still due before next payday */}
      <div className="mt-5">
        <p className="mini-label mb-2">Due before next paycheck</p>
        {billsStillDue.length === 0 ? (
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Nothing left — all bills for this period have cleared.
          </p>
        ) : (
          <ul className="flex flex-col gap-px bg-[var(--color-border)]">
            {billsStillDue.map((b) => (
              <li
                key={b.name}
                className="flex items-baseline justify-between gap-3 bg-[var(--color-surface)] py-2"
              >
                <span className="truncate text-sm text-[var(--color-text)]">
                  {b.name}
                </span>
                <span className="shrink-0 tabular-nums text-sm text-[var(--color-text-secondary)]">
                  {formatCurrency(b.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Cleared note */}
      {cleared.length > 0 && (
        <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">
          {cleared.length} of {bucketBills.length} already cleared ·{" "}
          {formatCurrency(clearedTotal)}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1 bg-[var(--color-surface)] py-3 sm:px-4 sm:first:pl-0">
      <span className="mini-label">{label}</span>
      <span className="text-lg tabular-nums text-[var(--color-text)]">{value}</span>
      <span className="text-xs text-[var(--color-text-tertiary)]">{hint}</span>
    </div>
  );
}
