// Shared formatting helpers for the cockpit. Kept framework-agnostic so both
// server components and "use client" components can import them.

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const currencyWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$1,234.56" — sign preserved. */
export function formatCurrency(value: number): string {
  return currency.format(value);
}

/** "$1,235" — no cents, for big headline stat numbers. */
export function formatCurrencyWhole(value: number): string {
  return currencyWhole.format(value);
}

/** CSS color token for a signed value (teal up / red down / muted zero). */
export function balanceColor(value: number): string {
  if (value > 0) return "var(--color-positive)";
  if (value < 0) return "var(--color-negative)";
  return "var(--color-text-secondary)";
}

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-06-11" -> "Jun 11". Parses the YYYY-MM-DD string directly (no TZ math). */
export function formatDayMonth(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  const mi = Number(m) - 1;
  return `${MONTHS_SHORT[mi] ?? m} ${Number(d)}`;
}

/** "2026-06" -> "Jun '26". */
export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const mi = Number(m) - 1;
  return `${MONTHS_SHORT[mi] ?? m} '${y.slice(2)}`;
}

/** Current epoch milliseconds. Wraps the impure clock read so callers can stamp
 *  a single `now` on the server and thread it through pure render code. */
export function nowMs(): number {
  return Date.now();
}

/**
 * "just now" / "2 hours ago" / "3 days ago" for a past ISO timestamp.
 * Coarse by design — this drives a sync freshness label, not a clock. Pass
 * `now` to keep it deterministic; defaults to the current time.
 */
export function formatRelativeTime(iso: string, now: number = nowMs()): string {
  const diffMs = now - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";

  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;

  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;

  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}
