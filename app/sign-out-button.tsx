"use client";

import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
    >
      Sign out
    </button>
  );
}
