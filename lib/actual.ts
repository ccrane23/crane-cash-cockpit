// Thin, server-side client for the Actual Budget data source.
//
// We no longer run the @actual-app/api SDK here. It assumes a normal Node
// filesystem layout that neither Windows nor Vercel's serverless bundle satisfy
// (the SDK resolves its migrations from a baked /ROOT path; Vercel unpacks the
// function to /var/task → ENOENT). Instead, a small bridge service on the Actual
// host (a normal Node runtime, where the SDK works fine) exposes the same
// normalized JSON over HTTPS, and we just fetch it.
//
// Contract (must match actual-bridge):
//   GET {BRIDGE_URL}/accounts       Authorization: Bearer {BRIDGE_BEARER_TOKEN}
//   200 -> { accounts: Account[] }
//   GET {BRIDGE_URL}/transactions?start=YYYY-MM-DD&end=YYYY-MM-DD
//   200 -> { transactions: Transaction[] }   (defaults to last 90 days)
//   GET {BRIDGE_URL}/sync-status
//   200 -> SyncStatus   (last cron sync result; reads stored state, never syncs)
//   GET {BRIDGE_URL}/groups
//   200 -> { groups: CategoryGroup[] }   (category→group rollup mapping)

export type Account = {
  id: string;
  name: string;
  balance: number; // major units (e.g. dollars), sign preserved
  offBudget: boolean;
  closed: boolean;
};

export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // signed major units (dollars); negative = outflow
  account: string;
  accountId: string;
  // Actual leaves these null for uncategorized / payee-less / note-less rows.
  payee: string | null;
  category: string | null;
  categoryId: string | null;
  notes: string | null;
  cleared: boolean;
  transfer: boolean;
};

// Result of the last cron sync, as cached by the bridge. syncedAt is null when
// the bridge has never recorded a successful run (fresh deploy / dead cron).
export type SyncStatus = {
  syncedAt: string | null; // ISO timestamp of the last sync, or null
  ok: boolean; // false if any account failed to sync
  failures: { id: string; name: string; error: string }[];
  accounts: {
    name: string;
    lastTransaction: string | null;
    daysStale: number | null;
    syncError: string | null;
  }[];
};

// A category group from Actual (e.g. "Essentials"), with the flat categories
// that roll up into it. isIncome flags Actual's income group, which we exclude
// from spending math.
export type CategoryGroup = {
  id: string;
  name: string;
  isIncome: boolean;
  categories: { id: string; name: string }[];
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function getAccounts(): Promise<Account[]> {
  const baseUrl = requireEnv("BRIDGE_URL"); // e.g. https://cranecashapp.com:5007
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
    // Sensitive, always-fresh financial data — never cache.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /accounts returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as { accounts?: Account[] };
  if (!Array.isArray(data.accounts)) {
    throw new Error("Bridge /accounts response missing 'accounts' array");
  }
  return data.accounts;
}

export async function getTransactions(range?: {
  start?: string; // YYYY-MM-DD
  end?: string; // YYYY-MM-DD
}): Promise<Transaction[]> {
  const baseUrl = requireEnv("BRIDGE_URL"); // e.g. https://cranecashapp.com:5007
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const url = new URL(`${baseUrl.replace(/\/$/, "")}/transactions`);
  if (range?.start) url.searchParams.set("start", range.start);
  if (range?.end) url.searchParams.set("end", range.end);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    // Sensitive, always-fresh financial data — never cache.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /transactions returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as { transactions?: Transaction[] };
  if (!Array.isArray(data.transactions)) {
    throw new Error("Bridge /transactions response missing 'transactions' array");
  }
  return data.transactions;
}

// Fetches the category→group rollup so the history chart can stack spending by
// group instead of flat category. Income groups are included in the payload; the
// caller filters them out of spending.
export async function getGroups(): Promise<CategoryGroup[]> {
  const baseUrl = requireEnv("BRIDGE_URL"); // e.g. https://cranecashapp.com:5007
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/groups`, {
    headers: { Authorization: `Bearer ${token}` },
    // Sensitive, always-fresh financial data — never cache.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /groups returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as { groups?: CategoryGroup[] };
  if (!Array.isArray(data.groups)) {
    throw new Error("Bridge /groups response missing 'groups' array");
  }
  return data.groups;
}

// Reads the bridge's stored result of the last cron sync. This never triggers a
// sync — it just surfaces when the data was last refreshed and whether any
// account failed, so the dashboard can warn about a stale or dead cron.
export async function getSyncStatus(): Promise<SyncStatus> {
  const baseUrl = requireEnv("BRIDGE_URL"); // e.g. https://cranecashapp.com:5007
  const token = requireEnv("BRIDGE_BEARER_TOKEN");

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/sync-status`, {
    headers: { Authorization: `Bearer ${token}` },
    // Sensitive, always-fresh financial data — never cache.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Bridge /sync-status returned ${res.status} ${res.statusText}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await res.json()) as Partial<SyncStatus>;
  // syncedAt may legitimately be null (never synced); only the shape is required.
  if (typeof data.ok !== "boolean" || !Array.isArray(data.failures)) {
    throw new Error("Bridge /sync-status response missing 'ok' / 'failures'");
  }
  return {
    syncedAt: data.syncedAt ?? null,
    ok: data.ok,
    failures: data.failures,
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
  };
}

// Errors from the fetch / its underlying layers carry their useful detail in
// non-enumerable or deeply-nested fields, so `console.error(err)` and
// JSON.stringify both render "{}". Pull the relevant bits out explicitly into a
// plain object we can log.
export function describeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Object)) {
    return { value: String(err) };
  }

  const e = err as Record<string, unknown> & {
    response?: { status?: unknown; statusText?: unknown; data?: unknown };
    cause?: unknown;
  };

  const detail: Record<string, unknown> = {
    name: e.name,
    message: e.message,
    code: e.code, // e.g. Node errno like ENOTFOUND, or TLS like UNABLE_TO_VERIFY_LEAF_SIGNATURE
    errno: e.errno,
    syscall: e.syscall,
    path: e.path,
    stack: e.stack,
  };

  // Axios / fetch-style HTTP failures hide the server's reply under `response`.
  if (e.response) {
    detail.response = {
      status: e.response.status,
      statusText: e.response.statusText,
      data: e.response.data,
    };
  }

  // Wrapped errors (e.g. TLS failures surfaced through fetch) keep the root under `cause`.
  if (e.cause && e.cause !== err) {
    detail.cause = describeError(e.cause);
  }

  // Surface anything else enumerable we didn't explicitly name.
  for (const [k, v] of Object.entries(e)) {
    if (!(k in detail)) detail[k] = v;
  }

  return detail;
}
