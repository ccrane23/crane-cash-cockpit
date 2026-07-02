"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SymbolMatch } from "@/lib/symbolSearch";

// Search-as-you-type ticker picker shared by the "Add purchase" and "Add to
// watchlist" forms. The parent owns the ticker string (controlled `value`); this
// component layers a debounced /api/symbol-search lookup and a keyboard-navigable
// dropdown on top of a plain text input.
//
// Manual entry is never blocked — you can type any ticker and submit — but
// picking a real match from the dropdown is the primary, encouraged path.

const DEBOUNCE_MS = 250;
const MIN_CHARS = 1;

export default function TickerAutocomplete({
  value,
  onChange,
  inputClassName,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  inputClassName: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [results, setResults] = useState<SymbolMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  // Set true right before a programmatic value change (a selection) so the
  // debounced search effect skips the re-fetch that change would otherwise
  // trigger — picking "AAPL" shouldn't immediately re-open the dropdown.
  const suppressRef = useRef(false);

  const listboxId = useId();

  useEffect(() => {
    if (suppressRef.current) {
      suppressRef.current = false;
      return;
    }

    const q = value.trim();
    const ctrl = new AbortController();
    // All state updates live inside the debounced callback (never synchronously
    // in the effect body) so a keystroke doesn't cascade a render before the
    // debounce window even elapses.
    const handle = setTimeout(async () => {
      if (q.length < MIN_CHARS) {
        setResults([]);
        setOpen(false);
        setNoMatch(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/symbol-search?q=${encodeURIComponent(q)}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        const data = res.ok ? await res.json() : { results: [] };
        const list: SymbolMatch[] = Array.isArray(data.results)
          ? data.results
          : [];
        setResults(list);
        setNoMatch(list.length === 0);
        setActiveIndex(-1);
        setOpen(true);
      } catch (err) {
        // A superseded keystroke aborts the in-flight request — ignore it and
        // let the newer effect run own the state.
        if ((err as Error)?.name === "AbortError") return;
        setResults([]);
        setNoMatch(true);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [value]);

  function select(symbol: string) {
    suppressRef.current = true;
    onChange(symbol);
    setResults([]);
    setNoMatch(false);
    setActiveIndex(-1);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      // Let Escape still dismiss a "no matches" panel.
      if (e.key === "Escape") setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        select(results[activeIndex].symbol);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showPanel = open && (results.length > 0 || noMatch);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (results.length > 0 || noMatch) setOpen(true);
        }}
        // Delay close so a mousedown-selected option still registers its click.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        disabled={disabled}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
        }
        className={inputClassName}
      />

      {loading && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-[var(--color-text-tertiary)]">
          …
        </span>
      )}

      {showPanel && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-[var(--color-gold)] bg-[var(--color-surface)] py-1 shadow-lg shadow-black/40"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
              No matching stocks. You can still type a ticker manually.
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.symbol}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // Prevent the input's blur from firing before the click so the
                // selection lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(r.symbol)}
                className={`flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm ${
                  i === activeIndex
                    ? "bg-[var(--color-gold)] text-[var(--color-bg)]"
                    : "text-[var(--color-text)]"
                }`}
              >
                <span
                  className={`shrink-0 font-medium tabular-nums ${
                    i === activeIndex
                      ? "text-[var(--color-bg)]"
                      : "text-[var(--color-gold)]"
                  }`}
                >
                  {r.symbol}
                </span>
                <span
                  className={`min-w-0 truncate ${
                    i === activeIndex
                      ? "text-[var(--color-bg)]/80"
                      : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {r.description}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
