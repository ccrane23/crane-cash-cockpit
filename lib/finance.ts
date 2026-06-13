// Pure aggregation over Actual data. No framework imports — easy to reason
// about and to unit-test. All money is in signed major units (dollars);
// negative amounts are outflows.

import type { Account, CategoryGroup, Transaction } from "./actual";

// ── Exclusion rules ──────────────────────────────────────────────────────────
// Actual seeds each account with a "Starting Balance" entry (category
// "Starting Balances" / payee "Starting Balance"). Those are not real cash flow
// and would wildly inflate income, so they're stripped from all spend/income
// math. Transfers (transfer: true) move money between our own accounts — also
// not income or spending. Likewise, anything categorized "Internal Transfers"
// is money shuffled between own accounts and is excluded from the math.

const STARTING_BALANCE_CATEGORY = "starting balances";
const STARTING_BALANCE_PAYEE = "starting balance";
const INTERNAL_TRANSFER_CATEGORY = "internal transfers";

export function isStartingBalance(tx: Transaction): boolean {
  return (
    tx.category?.trim().toLowerCase() === STARTING_BALANCE_CATEGORY ||
    tx.payee?.trim().toLowerCase() === STARTING_BALANCE_PAYEE
  );
}

/** Category Actual uses for money moved between own accounts that isn't flagged transfer:true. */
export function isInternalTransfer(tx: Transaction): boolean {
  return tx.category?.trim().toLowerCase() === INTERNAL_TRANSFER_CATEGORY;
}

/** True if a transaction counts toward real income/spending. */
export function isCashFlow(tx: Transaction): boolean {
  return !tx.transfer && !isStartingBalance(tx) && !isInternalTransfer(tx);
}

// ── Date helpers (string-based; no timezone math) ────────────────────────────

/** "2026-06-11" -> "2026-06". */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Current "YYYY-MM" in local time. */
export function currentMonthKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Today as "YYYY-MM-DD" in local time. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysInMonth(year: number, month1: number): number {
  // month1 is 1-based; day 0 of next month = last day of this month.
  return new Date(year, month1, 0).getDate();
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The N most recent month keys ending at `endMonth` (inclusive), oldest first. */
export function recentMonthKeys(endMonth: string, count: number): string[] {
  const [y, m] = endMonth.split("-").map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  return keys;
}

// ── Headline summary (the 4 stat cards) ──────────────────────────────────────

export type Summary = {
  /** Sum of balances across open, on-budget accounts; null if accounts are unavailable. */
  cashPosition: number | null;
  /** Total outflow (positive magnitude) this month, excluding transfers/starting. */
  spentMTD: number;
  /** Total income this month, excluding transfers/starting. */
  incomeMTD: number;
  /** incomeMTD - spentMTD. */
  netMTD: number;
};

export function computeSummary(
  accounts: Account[] | null,
  transactions: Transaction[],
  month: string = currentMonthKey(),
): Summary {
  const cashPosition = accounts
    ? accounts
        .filter((a) => !a.offBudget && !a.closed)
        .reduce((sum, a) => sum + a.balance, 0)
    : null;

  let spentMTD = 0;
  let incomeMTD = 0;
  for (const tx of transactions) {
    if (monthKey(tx.date) !== month || !isCashFlow(tx)) continue;
    if (tx.amount < 0) spentMTD += -tx.amount;
    else incomeMTD += tx.amount;
  }

  return {
    cashPosition,
    spentMTD,
    incomeMTD,
    netMTD: incomeMTD - spentMTD,
  };
}

// ── Category breakdown (the categories table) ────────────────────────────────
// We have no budgeted figures from the bridge, so "expected" spend is the
// trailing N-month average for that category. Variance = this month vs that
// baseline; positive variance means spending more than usual.

export const UNCATEGORIZED = "Uncategorized";

export type CategoryRow = {
  category: string;
  categoryId: string;
  /** This month's outflow magnitude (positive dollars). */
  actual: number;
  /** Average monthly outflow over the trailing window (positive dollars). */
  baseline: number;
  /** actual - baseline; positive = spending more than the trailing average. */
  variance: number;
  /** variance / baseline, or null when there's no baseline to compare against. */
  variancePct: number | null;
};

export function computeCategoryBreakdown(
  transactions: Transaction[],
  month: string = currentMonthKey(),
  trailingMonths = 3,
): CategoryRow[] {
  const trailing = new Set(
    recentMonthKeys(month, trailingMonths + 1).filter((m) => m !== month),
  );

  // category -> { id, actual, trailingSum }
  const acc = new Map<
    string,
    { id: string; label: string; actual: number; trailingSum: number }
  >();

  for (const tx of transactions) {
    if (!isCashFlow(tx) || tx.amount >= 0) continue; // outflows only
    const mk = monthKey(tx.date);
    const inCurrent = mk === month;
    const inTrailing = trailing.has(mk);
    if (!inCurrent && !inTrailing) continue;

    const label = tx.category?.trim() || UNCATEGORIZED;
    const key = tx.categoryId || label;
    const row =
      acc.get(key) ??
      { id: tx.categoryId || "", label, actual: 0, trailingSum: 0 };
    if (inCurrent) row.actual += -tx.amount;
    if (inTrailing) row.trailingSum += -tx.amount;
    acc.set(key, row);
  }

  const rows: CategoryRow[] = [];
  for (const r of acc.values()) {
    const baseline = r.trailingSum / trailingMonths;
    const variance = r.actual - baseline;
    rows.push({
      category: r.label,
      categoryId: r.id,
      actual: r.actual,
      baseline,
      variance,
      variancePct: baseline > 0 ? variance / baseline : null,
    });
  }

  // Biggest current spend first; ties broken by baseline.
  rows.sort((a, b) => b.actual - a.actual || b.baseline - a.baseline);
  return rows;
}

// ── Monthly history series (the stacked chart) ───────────────────────────────
// Spending is rolled up by category *group* (e.g. "Groceries" + "Mortgage" →
// "Essentials"). The bridge's /groups endpoint supplies the category→group
// mapping. There are only a handful of spending groups, so we stack all of them
// — no top-N / "Other" fold. Outflows whose category maps to no spending group
// (uncategorized, or a category the bridge didn't place) fall into a single
// neutral "Uncategorized" bucket so the monthly totals stay faithful.

export const UNCATEGORIZED_GROUP_ID = "__uncategorized__";

export type HistorySeries = {
  /** Stack/legend order: spending groups by window total, then "Uncategorized" if non-empty. */
  groups: { group: string; groupId: string }[];
  /** One entry per month (oldest→newest); `values` aligns to `groups`. */
  months: { month: string; total: number; values: number[] }[];
};

/** categoryId → spending group, plus the set of income-group category ids to exclude. */
function buildGroupLookup(groups: CategoryGroup[]): {
  byCategoryId: Map<string, { id: string; name: string }>;
  incomeCategoryIds: Set<string>;
} {
  const byCategoryId = new Map<string, { id: string; name: string }>();
  const incomeCategoryIds = new Set<string>();
  for (const g of groups) {
    for (const c of g.categories) {
      if (g.isIncome) incomeCategoryIds.add(c.id);
      else byCategoryId.set(c.id, { id: g.id, name: g.name });
    }
  }
  return { byCategoryId, incomeCategoryIds };
}

export function computeHistory(
  transactions: Transaction[],
  months: string[],
  groups: CategoryGroup[],
): HistorySeries {
  const monthSet = new Set(months);
  const { byCategoryId, incomeCategoryIds } = buildGroupLookup(groups);

  // group key -> { label, id, total } across the whole window (for stack order)
  const windowTotals = new Map<string, { label: string; id: string; total: number }>();
  // month -> (group key -> summed outflow)
  const perMonth = new Map<string, Map<string, number>>();

  for (const tx of transactions) {
    if (!isCashFlow(tx) || tx.amount >= 0) continue; // outflows only
    const mk = monthKey(tx.date);
    if (!monthSet.has(mk)) continue;
    // Exclude the income group from spending, beyond the outflow-only filter.
    if (tx.categoryId && incomeCategoryIds.has(tx.categoryId)) continue;

    const group = tx.categoryId ? byCategoryId.get(tx.categoryId) : undefined;
    const key = group?.id ?? UNCATEGORIZED_GROUP_ID;
    const label = group?.name ?? UNCATEGORIZED;
    const amt = -tx.amount;

    const wt = windowTotals.get(key) ?? { label, id: key, total: 0 };
    wt.total += amt;
    windowTotals.set(key, wt);

    const m = perMonth.get(mk) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + amt);
    perMonth.set(mk, m);
  }

  // Largest groups at the bottom of the stack; "Uncategorized" always last.
  const ranked = [...windowTotals.values()].sort((a, b) => {
    if (a.id === UNCATEGORIZED_GROUP_ID) return 1;
    if (b.id === UNCATEGORIZED_GROUP_ID) return -1;
    return b.total - a.total;
  });

  const seriesGroups = ranked.map((g) => ({ group: g.label, groupId: g.id }));

  const monthRows = months.map((mk) => {
    const m = perMonth.get(mk);
    const values = ranked.map((g) => m?.get(g.id) ?? 0);
    const total = values.reduce((s, v) => s + v, 0);
    return { month: mk, total, values };
  });

  return { groups: seriesGroups, months: monthRows };
}

// ── Recent activity ──────────────────────────────────────────────────────────
// A plain feed of the latest transactions. Starting balances are noise and get
// stripped; transfers stay (they're real movements worth seeing).

export function recentActivity(
  transactions: Transaction[],
  limit = 8,
): Transaction[] {
  return transactions
    .filter((tx) => !isStartingBalance(tx))
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

// ── Upcoming bills (derived from history) ────────────────────────────────────
// The bridge exposes no schedules, so we infer recurring bills: an outflow payee
// that shows up in ≥ `minMonths` distinct months is treated as a monthly bill.
// Amount/day are the medians of its history; the due date is its next monthly
// occurrence on/after today (next month if this month already paid).

export type UpcomingBill = {
  payee: string;
  category: string;
  amount: number; // typical outflow magnitude (positive dollars)
  dueDate: string; // YYYY-MM-DD (projected)
  lastPaid: string; // YYYY-MM-DD
  occurrences: number; // distinct months observed
  /** Observed payments (newest first) backing this projection. */
  payments: { date: string; amount: number }[];
};

export function computeUpcomingBills(
  transactions: Transaction[],
  today: string = todayISO(),
  { minMonths = 3, limit = 6 }: { minMonths?: number; limit?: number } = {},
): UpcomingBill[] {
  // Group recurring-looking outflows by payee.
  const byPayee = new Map<
    string,
    {
      days: number[];
      amounts: number[];
      months: Set<string>;
      categories: string[];
      last: string;
      payments: { date: string; amount: number }[];
    }
  >();

  for (const tx of transactions) {
    if (!isCashFlow(tx) || tx.amount >= 0) continue;
    const payee = tx.payee?.trim();
    if (!payee) continue;
    const g =
      byPayee.get(payee) ??
      {
        days: [],
        amounts: [],
        months: new Set<string>(),
        categories: [],
        last: "",
        payments: [],
      };
    g.days.push(Number(tx.date.slice(8, 10)));
    g.amounts.push(-tx.amount);
    g.months.add(monthKey(tx.date));
    g.payments.push({ date: tx.date, amount: -tx.amount });
    const cat = tx.category?.trim();
    if (cat) g.categories.push(cat);
    if (tx.date > g.last) g.last = tx.date;
    byPayee.set(payee, g);
  }

  const [ty, tm, td] = today.split("-").map(Number);
  const bills: UpcomingBill[] = [];

  for (const [payee, g] of byPayee) {
    if (g.months.size < minMonths) continue;

    const day = Math.round(median(g.days));
    const amount = median(g.amounts);
    const category = mode(g.categories) || UNCATEGORIZED;
    const paidThisMonth = g.months.has(`${ty}-${String(tm).padStart(2, "0")}`);

    // Candidate occurrence this month, clamped to the month length.
    const thisMonthDay = Math.min(day, daysInMonth(ty, tm));
    let dy = ty;
    let dm = tm;
    if (paidThisMonth || thisMonthDay < td) {
      // Roll to next month.
      dm = tm + 1;
      if (dm > 12) {
        dm = 1;
        dy = ty + 1;
      }
    }
    const dd = Math.min(day, daysInMonth(dy, dm));
    const dueDate = `${dy}-${String(dm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;

    bills.push({
      payee,
      category,
      amount,
      dueDate,
      lastPaid: g.last,
      occurrences: g.months.size,
      payments: g.payments
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .slice(0, 12),
    });
  }

  bills.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  return bills.slice(0, limit);
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  let best = "";
  let bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return best;
}
