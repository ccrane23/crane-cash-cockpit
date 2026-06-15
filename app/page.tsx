import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import {
  getAccounts,
  getTransactions,
  getSyncStatus,
  getGroups,
  findTdCheckingBalance,
  describeError,
  type Account,
  type Transaction,
  type CategoryGroup,
  type SyncStatus as SyncStatusData,
} from "@/lib/actual";
import {
  computeSummary,
  computeCategoryBreakdown,
  computeHistory,
  recentActivity,
  computeUpcomingBills,
  currentMonthKey,
  recentMonthKeys,
  monthKey,
} from "@/lib/finance";
import { computeSafeToSpend } from "@/lib/safe-to-spend";
import { nowMs } from "@/lib/format";
import type { DashboardData } from "./dashboard/model";
import Dashboard from "./dashboard/Dashboard";
import SyncStatus from "./dashboard/SyncStatus";
import SignOutButton from "./sign-out-button";
import Nav from "./Nav";

// Sensitive financial data — never cache, always render per request.
export const dynamic = "force-dynamic";

// We pull a rolling 12 months so the historical chart and trailing-average
// variance have data to work with.
const HISTORY_MONTHS = 12;

function firstDayOf(monthKey: string): string {
  return `${monthKey}-01`;
}

export default async function Home() {
  // Defense in depth alongside proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    redirect("/login");
  }

  const month = currentMonthKey();
  const months = recentMonthKeys(month, HISTORY_MONTHS);
  const start = firstDayOf(months[0]);

  // Fetch independently: transactions drive almost everything, so a flaky
  // /accounts (which only feeds cash position), /groups (just the history-chart
  // rollup), or /sync-status (just a freshness badge) must not blank the dashboard.
  const [accountsResult, transactionsResult, groupsResult, syncResult] =
    await Promise.allSettled([
      getAccounts(),
      getTransactions({ start }),
      getGroups(),
      getSyncStatus(),
    ]);

  let accounts: Account[] | null = null;
  if (accountsResult.status === "fulfilled") {
    accounts = accountsResult.value;
  } else {
    console.error("Failed to load accounts:", describeError(accountsResult.reason));
  }

  let groups: CategoryGroup[] = [];
  if (groupsResult.status === "fulfilled") {
    groups = groupsResult.value;
  } else {
    console.error("Failed to load groups:", describeError(groupsResult.reason));
  }

  let syncStatus: SyncStatusData | null = null;
  if (syncResult.status === "fulfilled") {
    syncStatus = syncResult.value;
  } else {
    console.error("Failed to load sync status:", describeError(syncResult.reason));
  }
  // Stamp once on the server so the relative-time label is stable across
  // SSR/hydration in <SyncStatus>.
  const now = nowMs();

  let transactions: Transaction[] | null = null;
  let error: string | null = null;
  if (transactionsResult.status === "fulfilled") {
    transactions = transactionsResult.value;
  } else {
    console.error(
      "Failed to load transactions:",
      describeError(transactionsResult.reason),
    );
    error = "Could not reach the Actual budget server.";
  }

  let data: DashboardData | null = null;
  if (transactions) {
    // Safe-to-Spend keys off the TD checking balance; null-degrade if the
    // account (or all of /accounts) is unavailable this request.
    const tdBalance = accounts ? findTdCheckingBalance(accounts) : null;

    data = {
      summary: computeSummary(accounts, transactions, month),
      safeToSpend: tdBalance !== null ? computeSafeToSpend(tdBalance) : null,
      month,
      categories: computeCategoryBreakdown(transactions, month),
      history: computeHistory(transactions, months, groups),
      recent: recentActivity(transactions),
      bills: computeUpcomingBills(transactions),
      accountsAvailable: accounts !== null,
      accounts: (accounts ?? []).filter((a) => !a.closed),
      monthTransactions: transactions
        .filter((t) => monthKey(t.date) === month)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    };
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 flex flex-col gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-6 pb-4 pt-6 sm:px-10 sm:pt-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
              Crane Cash
            </p>
            <h1 className="mt-1 text-xl font-medium text-[var(--color-text)]">
              Banking
            </h1>
            {syncStatus && <SyncStatus status={syncStatus} now={now} />}
          </div>
          <SignOutButton />
        </div>
        <Nav />
      </header>

      <div className="px-6 pb-6 sm:px-10 sm:pb-10">
        {error ? (
          <p className="mt-8 text-[var(--color-negative)]">{error}</p>
        ) : data ? (
          <div className="mt-6">
            <Dashboard data={data} />
          </div>
        ) : (
          <p className="mt-8 text-[var(--color-text-secondary)]">Loading…</p>
        )}
      </div>
    </main>
  );
}
