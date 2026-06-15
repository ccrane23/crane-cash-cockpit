"use client";

import { useState } from "react";
import type { SafeToSpend as SafeToSpendData } from "@/lib/safe-to-spend";
import { BILLS } from "@/lib/safe-to-spend";
import { formatCurrency, formatDayMonth } from "@/lib/format";

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

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

  // Privacy toggle for the headline figure only. Defaults to visible and resets
  // on each load (plain state — no persistence).
  const [revealed, setRevealed] = useState(true);

  return (
    <div className="bg-[var(--color-surface)] p-5 sm:p-6">
      <div className="flex items-baseline justify-between">
        <p className="mini-label">Pay period {bucket}</p>
        <p className="mini-label">{RANGE[bucket]}</p>
      </div>

      {/* Headline + privacy toggle. Hidden state blurs the figure in place so the
          layout never shifts; only this number is affected. */}
      <div className="mt-3 flex items-center gap-3">
        <p
          className={`text-4xl tabular-nums transition-[filter] duration-200 sm:text-5xl ${
            revealed ? "" : "select-none"
          }`}
          style={{
            color: headlineColor,
            filter: revealed ? undefined : "blur(11px)",
          }}
          aria-hidden={!revealed}
        >
          {formatCurrency(safeToSpend)}
        </p>
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={
            revealed
              ? "Hide safe to spend amount"
              : "Show safe to spend amount"
          }
          aria-pressed={!revealed}
          className="shrink-0 text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-gold)]"
        >
          {revealed ? <EyeIcon /> : <EyeOffIcon />}
        </button>
      </div>
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
