// The serializable view-model the server page computes and hands to the client
// <Dashboard>. Keep every field a plain JSON value so it crosses the
// server→client boundary cleanly.

import type {
  Summary,
  CategoryRow,
  HistorySeries,
  UpcomingBill,
} from "@/lib/finance";
import type { Account, Transaction } from "@/lib/actual";
import type { SafeToSpend } from "@/lib/safe-to-spend";

export type DashboardData = {
  summary: Summary;
  /** Free-to-spend view; null when the TD checking balance is unavailable. */
  safeToSpend: SafeToSpend | null;
  month: string; // "YYYY-MM" the MTD figures cover
  categories: CategoryRow[];
  history: HistorySeries;
  recent: Transaction[];
  bills: UpcomingBill[];
  /** False when the bridge /accounts endpoint was unreachable this request. */
  accountsAvailable: boolean;
  /** Open accounts, for the cash-position drill-down (empty if unavailable). */
  accounts: Account[];
  /** Current-month transactions, powering the stat-card / category drawers. */
  monthTransactions: Transaction[];
};

import type { StatKey } from "./StatCards";

// What the user clicked into. Drives the drill-down drawer.
export type Selection =
  | { kind: "stat"; key: StatKey }
  | { kind: "category"; categoryId: string; category: string }
  | { kind: "account"; accountId: string }
  | { kind: "transaction"; tx: Transaction }
  | { kind: "bill"; bill: UpcomingBill };
