"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not sign in");
        setLoading(false);
      }
    } catch {
      setError("Could not sign in");
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm border border-[var(--color-border)] bg-[var(--color-surface)] p-8"
      >
        <p className="mini-label">Crane Cash Cockpit</p>
        <h1 className="mt-2 text-lg font-medium text-[var(--color-text)]">
          Enter password
        </h1>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          aria-label="Password"
          className="mt-6 w-full border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] outline-none focus:border-[var(--color-gold)]"
        />

        {error && (
          <p className="mt-3 text-sm text-[var(--color-negative)]">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || password.length === 0}
          className="mt-6 w-full bg-[var(--color-positive)] px-3 py-2 font-medium text-[var(--color-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
