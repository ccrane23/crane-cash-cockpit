import type { Transaction } from "@/lib/actual";
import { isCashFlow, UNCATEGORIZED } from "@/lib/finance";
import {
  formatCurrency,
  formatCurrencyWhole,
  formatDayMonth,
  balanceColor,
} from "@/lib/format";
import type { DashboardData, Selection } from "./model";

// Derive the drawer's header text from the current selection.
export function drawerHeader(
  selection: Selection,
  data: DashboardData,
): { title: string; subtitle: string } {
  switch (selection.kind) {
    case "stat": {
      const map = {
        cash: { title: "Cash Position", subtitle: "On-budget accounts" },
        spent: { title: "Spent this month", subtitle: "Outflows · excl. transfers" },
        income: { title: "Income this month", subtitle: "Inflows · excl. transfers" },
        net: { title: "Net Flow this month", subtitle: "Income − spend" },
      };
      return map[selection.key];
    }
    case "category":
      return { title: selection.category, subtitle: "This month · vs trailing avg" };
    case "account": {
      const a = data.accounts.find((x) => x.id === selection.accountId);
      return {
        title: a?.name ?? "Account",
        subtitle: a ? formatCurrency(a.balance) : "",
      };
    }
    case "transaction":
      return {
        title: selection.tx.payee || selection.tx.category || "Transaction",
        subtitle: formatDayMonth(selection.tx.date),
      };
    case "bill":
      return {
        title: selection.bill.payee,
        subtitle: `Projected ${formatDayMonth(selection.bill.dueDate)}`,
      };
  }
}

function matchesCategory(tx: Transaction, sel: Extract<Selection, { kind: "category" }>) {
  if (!isCashFlow(tx) || tx.amount >= 0) return false;
  if (sel.categoryId) return tx.categoryId === sel.categoryId;
  return (tx.category?.trim() || UNCATEGORIZED) === sel.category;
}

export default function DrawerContent({
  selection,
  data,
  onNavigate,
}: {
  selection: Selection;
  data: DashboardData;
  onNavigate?: (s: Selection) => void;
}) {
  switch (selection.kind) {
    case "stat": {
      if (selection.key === "cash") {
        if (!data.accountsAvailable) {
          return (
            <p className="px-5 py-6 text-sm text-[var(--color-text-tertiary)]">
              The bridge ‘/accounts’ endpoint is currently unreachable, so
              balances can’t be shown. Transaction-based figures are unaffected.
            </p>
          );
        }
        const accts = data.accounts.filter((a) => !a.offBudget && !a.closed);
        const total = accts.reduce((s, a) => s + a.balance, 0);
        return (
          <div>
            <TotalBar label="Total" value={total} />
            <ul>
              {accts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={
                      onNavigate
                        ? () => onNavigate({ kind: "account", accountId: a.id })
                        : undefined
                    }
                    className="flex w-full items-baseline justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-[#1c1c1c]"
                  >
                    <span className="truncate text-[var(--color-text)]">
                      {a.name}
                    </span>
                    <span
                      className="tabular-nums"
                      style={{ color: balanceColor(a.balance) }}
                    >
                      {formatCurrency(a.balance)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      }
      const txns = data.monthTransactions.filter((t) => {
        if (!isCashFlow(t)) return false;
        if (selection.key === "spent") return t.amount < 0;
        if (selection.key === "income") return t.amount > 0;
        return true; // net
      });
      const total = txns.reduce((s, t) => s + t.amount, 0);
      return (
        <div>
          <TotalBar
            label={selection.key === "spent" ? "Total out" : selection.key === "income" ? "Total in" : "Net"}
            value={selection.key === "spent" ? -total : total}
            signed={selection.key === "net"}
          />
          <TxList items={txns} onSelect={onNavigate} />
        </div>
      );
    }

    case "category": {
      const txns = data.monthTransactions.filter((t) =>
        matchesCategory(t, selection),
      );
      const total = txns.reduce((s, t) => s + -t.amount, 0);
      const row = data.categories.find(
        (r) =>
          (selection.categoryId && r.categoryId === selection.categoryId) ||
          r.category === selection.category,
      );
      return (
        <div>
          <TotalBar label="Spent this month" value={total} />
          {row && (
            <div className="flex items-baseline justify-between border-b border-[var(--color-border)] px-5 py-3 text-sm">
              <span className="text-[var(--color-text-secondary)]">
                Trailing 3-mo avg
              </span>
              <span className="tabular-nums text-[var(--color-text-secondary)]">
                {formatCurrency(row.baseline)}
              </span>
            </div>
          )}
          <TxList items={txns} onSelect={onNavigate} />
        </div>
      );
    }

    case "account": {
      const txns = data.monthTransactions.filter(
        (t) => t.accountId === selection.accountId,
      );
      return (
        <div>
          <p className="px-5 py-3 text-xs text-[var(--color-text-tertiary)]">
            Transactions this month
          </p>
          <TxList items={txns} onSelect={onNavigate} />
        </div>
      );
    }

    case "transaction": {
      const tx = selection.tx;
      return (
        <dl className="divide-y divide-[var(--color-border)]">
          <Field label="Amount">
            <span style={{ color: balanceColor(tx.amount) }}>
              {formatCurrency(tx.amount)}
            </span>
          </Field>
          <Field label="Date">{tx.date}</Field>
          <Field label="Payee">{tx.payee || "—"}</Field>
          <Field label="Category">{tx.category || "Uncategorized"}</Field>
          <Field label="Account">{tx.account}</Field>
          <Field label="Cleared">{tx.cleared ? "Yes" : "No"}</Field>
          <Field label="Transfer">{tx.transfer ? "Yes" : "No"}</Field>
          {tx.notes && <Field label="Notes">{tx.notes}</Field>}
        </dl>
      );
    }

    case "bill": {
      const b = selection.bill;
      return (
        <div>
          <dl className="divide-y divide-[var(--color-border)] border-b border-[var(--color-border)]">
            <Field label="Typical amount">{formatCurrency(b.amount)}</Field>
            <Field label="Next due">{b.dueDate}</Field>
            <Field label="Last paid">{b.lastPaid}</Field>
            <Field label="Category">{b.category}</Field>
            <Field label="Months seen">{String(b.occurrences)}</Field>
          </dl>
          <p className="px-5 pt-4 pb-2 mini-label">Payment history</p>
          <ul>
            {b.payments.map((p, i) => (
              <li
                key={`${p.date}-${i}`}
                className="flex items-baseline justify-between border-b border-[var(--color-border)] px-5 py-2.5 text-sm last:border-b-0"
              >
                <span className="tabular-nums text-[var(--color-text-tertiary)]">
                  {p.date}
                </span>
                <span className="tabular-nums text-[var(--color-text)]">
                  {formatCurrency(p.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
  }
}

function TotalBar({
  label,
  value,
  signed = false,
}: {
  label: string;
  value: number;
  signed?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-4">
      <span className="mini-label">{label}</span>
      <span
        className="text-xl tabular-nums"
        style={{ color: signed ? balanceColor(value) : "var(--color-text)" }}
      >
        {formatCurrencyWhole(value)}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-3">
      <dt className="text-sm text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="min-w-0 truncate text-right tabular-nums text-[var(--color-text)]">
        {children}
      </dd>
    </div>
  );
}

function TxList({
  items,
  onSelect,
}: {
  items: Transaction[];
  onSelect?: (s: Selection) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-[var(--color-text-tertiary)]">
        No transactions.
      </p>
    );
  }
  return (
    <ul>
      {items.map((tx) => (
        <li key={tx.id}>
          <button
            type="button"
            onClick={
              onSelect ? () => onSelect({ kind: "transaction", tx }) : undefined
            }
            className="flex w-full items-baseline justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-[#1c1c1c]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[var(--color-text)]">
                {tx.payee || tx.category || "—"}
              </span>
              <span className="mt-0.5 block truncate text-xs text-[var(--color-text-tertiary)]">
                {tx.category || "Uncategorized"} · {formatDayMonth(tx.date)}
              </span>
            </span>
            <span
              className="shrink-0 tabular-nums"
              style={{ color: balanceColor(tx.amount) }}
            >
              {formatCurrency(tx.amount)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
