import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getAccounts, describeError, type Account } from "@/lib/actual";
import SignOutButton from "./sign-out-button";

// Sensitive financial data — never cache, always render per request.
export const dynamic = "force-dynamic";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatBalance(value: number): string {
  return currency.format(value);
}

function balanceColor(value: number): string {
  if (value > 0) return "var(--color-positive)";
  if (value < 0) return "var(--color-negative)";
  return "var(--color-text-secondary)";
}

export default async function Home() {
  // Defense in depth alongside proxy.ts.
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) {
    redirect("/login");
  }

  let accounts: Account[] | null = null;
  let error: string | null = null;
  try {
    accounts = await getAccounts();
  } catch (err) {
    console.error(
      "Failed to load accounts from Actual:",
      describeError(err),
    );
    error = "Could not reach the Actual budget server.";
  }

  const open = accounts?.filter((a) => !a.closed) ?? [];
  const total = open.reduce((sum, a) => sum + a.balance, 0);

  return (
    <main className="flex flex-1 flex-col p-6 sm:p-10">
      <header className="flex items-baseline justify-between border-b border-[var(--color-border)] pb-4">
        <div>
          <p className="mini-label">Crane Cash Cockpit</p>
          <h1 className="mt-1 text-xl font-medium text-[var(--color-text)]">
            Accounts
          </h1>
        </div>
        {accounts && (
          <div className="text-right">
            <p className="mini-label">Total</p>
            <p
              className="mt-1 text-xl"
              style={{ color: balanceColor(total) }}
            >
              {formatBalance(total)}
            </p>
          </div>
        )}
      </header>

      {error ? (
        <p className="mt-8 text-[var(--color-negative)]">{error}</p>
      ) : open.length === 0 ? (
        <p className="mt-8 text-[var(--color-text-secondary)]">
          No accounts found.
        </p>
      ) : (
        <ul className="mt-2">
          {open.map((account) => (
            <li
              key={account.id}
              className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] py-4"
            >
              <span className="text-[var(--color-text)]">
                {account.name}
                {account.offBudget && (
                  <span className="ml-2 text-[var(--color-text-tertiary)]">
                    off budget
                  </span>
                )}
              </span>
              <span
                className="tabular-nums"
                style={{ color: balanceColor(account.balance) }}
              >
                {formatBalance(account.balance)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto pt-10 text-sm">
        <SignOutButton />
      </footer>
    </main>
  );
}
