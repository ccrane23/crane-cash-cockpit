import { mkdirSync } from "fs";
import * as api from "@actual-app/api";

// Thin, isolated server-side client for the Actual Budget data source.
// Stock actual-server has no plain REST endpoint for balances, so we use the
// official @actual-app/api SDK: init -> downloadBudget -> query -> shutdown.
//
// Phase 1: every call re-downloads the budget to /tmp. That's fine for now;
// caching the downloaded budget across requests is a later optimization.
//
// The SDK keeps module-global state and is NOT safe to run concurrently, so we
// serialize all access through a single promise chain.

export type Account = {
  id: string;
  name: string;
  balance: number; // major units (e.g. dollars), sign preserved
  offBudget: boolean;
  closed: boolean;
};

const DATA_DIR = "/tmp/actual-budget";

let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  // Keep the chain alive regardless of this task's outcome.
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// Errors from the SDK / its HTTP layer carry their useful detail in non-enumerable
// or deeply-nested fields, so `console.error(err)` and JSON.stringify both render
// "{}". Pull the relevant bits out explicitly into a plain object we can log.
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
    code: e.code, // e.g. Node errno like ENOENT, or SSL like UNABLE_TO_VERIFY_LEAF_SIGNATURE
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

  // Wrapped errors (e.g. SSL failures surfaced through fetch) keep the root under `cause`.
  if (e.cause && e.cause !== err) {
    detail.cause = describeError(e.cause);
  }

  // Surface anything else enumerable we didn't explicitly name.
  for (const [k, v] of Object.entries(e)) {
    if (!(k in detail)) detail[k] = v;
  }

  return detail;
}

export function getAccounts(): Promise<Account[]> {
  return serialize(async () => {
    const serverURL = requireEnv("ACTUAL_SERVER_URL");
    const password = requireEnv("ACTUAL_PASSWORD");
    const syncId = requireEnv("ACTUAL_SYNC_ID");

    // Log the resolved config (minus the password) so we can confirm what the SDK
    // actually receives — wrong sync ID format / server URL shows up here.
    console.error("[actual] getAccounts starting", {
      serverURL,
      syncId,
      dataDir: DATA_DIR,
      passwordSet: Boolean(password),
      platform: process.platform,
    });

    let stage = "mkdir";
    try {
      mkdirSync(DATA_DIR, { recursive: true });

      stage = "init";
      await api.init({ dataDir: DATA_DIR, serverURL, password });
      try {
        stage = "downloadBudget";
        await api.downloadBudget(syncId);

        stage = "getAccounts";
        const raw = await api.getAccounts();

        stage = "getAccountBalance";
        const accounts = await Promise.all(
          raw.map(async (a) => {
            const cents = await api.getAccountBalance(a.id);
            return {
              id: a.id,
              name: a.name,
              balance: api.utils.integerToAmount(cents),
              offBudget: Boolean(a.offbudget),
              closed: Boolean(a.closed),
            } satisfies Account;
          }),
        );
        return accounts;
      } finally {
        await api.shutdown();
      }
    } catch (err) {
      console.error(
        `[actual] getAccounts failed at stage "${stage}":`,
        describeError(err),
      );
      throw err;
    }
  });
}
