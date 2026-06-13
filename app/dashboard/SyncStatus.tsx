"use client";

import { useState } from "react";
import type { SyncStatus as SyncStatusData } from "@/lib/actual";
import { formatRelativeTime } from "@/lib/format";

// The cron runs daily; anything past ~26h means a run was missed — treat the
// data as stale and raise the dead-cron warning.
const STALE_MS = 26 * 60 * 60 * 1000;

type Tone = {
  color: string;
  label: string;
  /** Failed account names, shown on expand when present. */
  failures: { name: string; error: string }[];
};

// Derive the dot color + line from the stored sync result. `now` is stamped on
// the server and passed through so SSR and hydration agree on the relative time.
function derive(status: SyncStatusData, now: number): Tone {
  const { syncedAt, failures } = status;

  if (syncedAt === null) {
    return { color: "var(--color-negative)", label: "Never synced", failures };
  }

  const ago = formatRelativeTime(syncedAt, now);
  const stale = now - new Date(syncedAt).getTime() > STALE_MS;

  if (stale) {
    return { color: "var(--color-negative)", label: `Last synced ${ago}`, failures };
  }

  if (failures.length > 0) {
    const n = failures.length;
    return {
      color: "var(--color-gold)",
      label: `Synced ${ago} · ${n} account${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`,
      failures,
    };
  }

  return { color: "var(--color-positive)", label: `Synced ${ago}`, failures };
}

export default function SyncStatus({
  status,
  now,
}: {
  status: SyncStatusData;
  now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = derive(status, now);
  const hasFailures = tone.failures.length > 0;

  const dot = (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: tone.color }}
    />
  );

  const text = (
    <span className="text-xs text-[var(--color-text-secondary)]">{tone.label}</span>
  );

  if (!hasFailures) {
    return (
      <div className="mt-2 flex items-center gap-2">
        {dot}
        {text}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-2 text-left transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-gold)]"
      >
        {dot}
        {text}
        <span className="text-[var(--color-text-tertiary)]">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <ul className="ccc-fade-in mt-2 flex flex-col gap-1 border-l border-[var(--color-border)] pl-3">
          {tone.failures.map((f) => (
            <li key={f.name} className="text-xs">
              <span className="text-[var(--color-text)]">{f.name}</span>
              <span className="text-[var(--color-text-tertiary)]"> — {f.error}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
