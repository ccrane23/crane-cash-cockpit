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
