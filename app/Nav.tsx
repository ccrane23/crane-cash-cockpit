"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Top-level section switch between the cash dashboard and investments. The
// active tab takes the gold accent; the rest sit at tertiary contrast like the
// other chrome.
const TABS = [
  { href: "/", label: "Cash" },
  { href: "/investments", label: "Investments" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-5">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`mini-label transition-colors ${
              active
                ? "text-[var(--color-gold)]"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
