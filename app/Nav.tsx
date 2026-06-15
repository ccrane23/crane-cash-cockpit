"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Top-level section switch between the banking dashboard and investments,
// rendered as pills so they read clearly as tappable tabs. Active pill takes a
// gold fill; inactive ones are muted with a subtle border.
const TABS = [
  { href: "/", label: "Banking" },
  { href: "/investments", label: "Investments" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-2">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full border px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] transition-colors ${
              active
                ? "border-[var(--color-gold)] bg-[var(--color-gold)] text-[var(--color-bg)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
