import * as api from "@actual-app/api";

// SDK wrapper, ported from the Next app's old lib/actual.ts. Unlike Vercel's
// serverless runtime, this is a long-lived process with a real persistent disk,
// so we initialize the SDK ONCE at first use and only api.sync() per request.
//
// The SDK keeps module-global state and is NOT concurrency-safe, so every call
// is serialized through a single promise chain.

/**
 * @typedef {Object} Account
 * @property {string} id
 * @property {string} name
 * @property {number} balance   major units (e.g. dollars), sign preserved
 * @property {boolean} offBudget
 * @property {boolean} closed
 */

const DATA_DIR = process.env.DATA_DIR || "/data";

/** @type {Promise<void> | null} */
let ready = null;
/** @type {Promise<unknown>} */
let chain = Promise.resolve();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function serialize(task) {
  const run = chain.then(task, task);
  // Keep the chain alive regardless of this task's outcome.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Initialize + download the budget exactly once for the lifetime of the process.
// On failure we reset `ready` so a later request can retry instead of being
// permanently wedged.
function ensureReady() {
  if (!ready) {
    ready = (async () => {
      const serverURL = requireEnv("ACTUAL_SERVER_URL");
      const password = requireEnv("ACTUAL_PASSWORD");
      const syncId = requireEnv("ACTUAL_SYNC_ID");
      console.log("[bridge] initializing SDK", { serverURL, syncId, DATA_DIR });
      await api.init({ dataDir: DATA_DIR, serverURL, password });
      await api.downloadBudget(syncId);
      console.log("[bridge] SDK ready");
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** @returns {Promise<Account[]>} */
export function getAccounts() {
  return serialize(async () => {
    await ensureReady();
    await api.sync(); // pull the latest deltas before reading
    const raw = await api.getAccounts();
    return Promise.all(
      raw.map(async (a) => {
        const cents = await api.getAccountBalance(a.id);
        return {
          id: a.id,
          name: a.name,
          balance: api.utils.integerToAmount(cents),
          offBudget: Boolean(a.offbudget),
          closed: Boolean(a.closed),
        };
      }),
    );
  });
}

/**
 * @param {string} [startDate]  ISO date 'YYYY-MM-DD', inclusive. Defaults to 90 days ago.
 * @param {string} [endDate]    ISO date 'YYYY-MM-DD', inclusive. Defaults to today.
 * @returns {Promise<object[]>}
 */
export function getTransactions(startDate, endDate) {
  return serialize(async () => {
    await ensureReady();
    await api.sync();

    const end = endDate || new Date().toISOString().slice(0, 10);
    const start =
      startDate ||
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Build id->name lookups so the dashboard gets readable labels, not UUIDs.
    const accounts = await api.getAccounts();
    const categories = await api.getCategories();
    const payees = await api.getPayees();
    const acctName = new Map(accounts.map((a) => [a.id, a.name]));
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const payeeName = new Map(payees.map((p) => [p.id, p.name]));

    // Pull transactions per account, then flatten.
    const all = [];
    for (const a of accounts) {
      const txns = await api.getTransactions(a.id, start, end);
      for (const t of txns) {
        all.push({
          id: t.id,
          date: t.date,
          amount: api.utils.integerToAmount(t.amount),
          account: acctName.get(a.id) || a.id,
          accountId: a.id,
          payee: payeeName.get(t.payee) || null,
          category: catName.get(t.category) || null,
          categoryId: t.category || null,
          notes: t.notes || null,
          cleared: Boolean(t.cleared),
          transfer: Boolean(t.transfer_id),
        });
      }
    }

    // Newest first.
    all.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
    return all;
  });
}

/**
 * Triggers a bank sync (pulls fresh transactions from SimpleFIN), then reports
 * per-account freshness so callers can detect stale connections.
 * @returns {Promise<{ok: boolean, syncedAt: string, accounts: object[], error?: string}>}
 */
/**
 * Syncs each account individually so one bad bank connection can't crash the
 * whole batch (or the process). Reports per-account success/failure + freshness.
 * @returns {Promise<{ok: boolean, syncedAt: string, failures: object[], accounts: object[]}>}
 */
export function runSync() {
  return serialize(async () => {
    await ensureReady();
    await api.sync();

    const today = new Date().toISOString().slice(0, 10);
    const accounts = await api.getAccounts();
    const failures = [];
    const report = [];

    for (const a of accounts) {
      if (a.closed) continue;

      // Sync this one account in isolation. A failure here is captured, not thrown.
      let syncError = null;
      try {
        await api.runBankSync({ accountId: a.id });
      } catch (err) {
        syncError = err && err.message ? err.message : String(err);
        console.error(`[bridge] sync failed for "${a.name}":`, syncError);
        failures.push({ id: a.id, name: a.name, error: syncError });
      }

      // Freshness: most recent transaction date for this account.
      const txns = await api.getTransactions(a.id, "2000-01-01", today);
      let lastDate = null;
      for (const t of txns) {
        if (!lastDate || t.date > lastDate) lastDate = t.date;
      }
      const daysStale =
        lastDate == null
          ? null
          : Math.floor(
              (Date.parse(today) - Date.parse(lastDate)) / (1000 * 60 * 60 * 24),
            );

      report.push({
        id: a.id,
        name: a.name,
        offBudget: Boolean(a.offbudget),
        lastTransaction: lastDate,
        daysStale,
        syncError,
      });
    }

    await api.sync(); // flush any new deltas

    return {
      ok: failures.length === 0,
      syncedAt: new Date().toISOString(),
      failures,
      accounts: report,
    };
  });
}
