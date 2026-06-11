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
      className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
    >
      Sign out
    </button>
  );
}
