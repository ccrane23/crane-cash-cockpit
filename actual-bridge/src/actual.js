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
