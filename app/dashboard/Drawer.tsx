"use client";

import { useEffect } from "react";

// Generic right-side slide-over. The drill-down content is passed as children;
// this shell only owns the chrome (backdrop, header, close, Esc, scroll lock).
export default function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        onClick={onClose}
        className="ccc-fade-in absolute inset-0 bg-black/60"
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        className="ccc-slide-in absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg text-[var(--color-text)]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 px-2 text-xl text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-gold)]"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
