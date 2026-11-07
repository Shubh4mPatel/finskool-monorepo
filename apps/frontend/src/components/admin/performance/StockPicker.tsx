"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { stocksApi, type StockOption } from "@/lib/stocks";
import { inputCls } from "@/components/admin/members/memberUi";
import { StockAvatar } from "./StockAvatar";

/** Fewer letters than this match too many stocks to be worth asking the server. */
const MIN_CHARS = 2;
/** Waits for a pause in typing, so a name typed quickly is one request and not one per letter. */
const DEBOUNCE_MS = 250;

interface Found {
  term: string;
  rows: StockOption[];
  failed: boolean;
}

/** One shared empty list, so "no results yet" is the same value on every render. */
const NO_ROWS: StockOption[] = [];

/**
 * A text field that suggests stocks, each with its logo, as the admin types. Picking one fills in the stock's exact name, which
 * is what the board matches on to show the logo. The text stays free: a stock that is not in the list can still be typed.
 */
export default function StockPicker({
  value,
  onChange,
  onPick,
  selected = null,
  error,
  disabled = false,
  placeholder,
  ariaLabel,
}: {
  value: string;
  /** The text changed by typing. */
  onChange: (text: string) => void;
  /** A suggestion was chosen. */
  onPick: (stock: StockOption) => void;
  /** The stock the text stands for, so its logo can be shown in the field. Ignored once the text no longer matches its name. */
  selected?: { name: string; logoUrl: string | null } | null;
  error?: string | undefined;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [floating, setFloating] = useState<CSSProperties | null>(null);

  const term = value.trim();
  const showList = open && term.length >= MIN_CHARS;
  // An answer belongs to the text it was asked for; one for older text is not shown.
  const answer = showList && found?.term === term ? found : null;
  const rows = answer?.rows ?? NO_ROWS;

  useEffect(() => {
    if (!showList) return;
    let stale = false;
    const timer = setTimeout(() => {
      stocksApi.search(term).then(
        result => {
          if (stale) return;
          setFound({ term, rows: result, failed: false });
          setHighlight(0);
        },
        () => {
          if (!stale) setFound({ term, rows: [], failed: true });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [showList, term]);

  // The list floats over the page (the modal's body scrolls and would clip it), pinned under the field or above it when short of room.
  useLayoutEffect(() => {
    if (!showList) return;
    const place = () => {
      const t = inputRef.current?.getBoundingClientRect();
      if (!t) return;
      const below = window.innerHeight - t.bottom;
      const flip = below < 300 && t.top > below;
      setFloating({ position: "fixed", left: t.left, width: t.width, ...(flip ? { bottom: window.innerHeight - t.top + 8 } : { top: t.bottom + 8 }) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [showList]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  // Keep the highlighted suggestion in view while arrowing through the list.
  useEffect(() => {
    if (!showList) return;
    popupRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [showList, highlight, rows]);

  function pick(stock: StockOption) {
    onPick(stock);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      if (rows.length > 0) setHighlight(h => (e.key === "ArrowDown" ? Math.min(rows.length - 1, h + 1) : Math.max(0, h - 1)));
      return;
    }
    if (!showList) return;
    if (e.key === "Enter") {
      const stock = rows[highlight];
      if (stock) {
        e.preventDefault();
        pick(stock);
      }
    } else if (e.key === "Escape") {
      // Closes the list only; the dialog behind it stays open.
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const showSelected = selected !== null && selected.name === value;
  const message = answer?.failed
    ? "Could not search the stocks. What you typed will be used as it is."
    : answer
      ? `No stock matches “${term}”. What you typed will be used, without a logo.`
      : "Searching…";

  return (
    <div ref={rootRef} className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center">
        {showSelected ? <StockAvatar name={selected.name} logoUrl={selected.logoUrl} className="h-6 w-6" /> : <Search size={15} className="text-subtle" aria-hidden />}
      </span>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showList && rows[highlight] ? `${listId}-${highlight}` : undefined}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className={`${inputCls(error)} pl-11`}
      />

      {showList &&
        createPortal(
          <div
            ref={popupRef}
            style={floating ?? { position: "fixed", visibility: "hidden" }}
            className="animate-fade z-[70] overflow-hidden rounded-2xl border border-divider bg-white shadow-card-hover"
          >
            {rows.length > 0 ? (
              <ul id={listId} role="listbox" aria-label={`${ariaLabel} suggestions`} className="max-h-72 overflow-y-auto p-1.5 scrollbar-slim">
                {rows.map((stock, i) => (
                  <li
                    key={stock.id}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === highlight}
                    // Keeps the focus in the field, so picking does not blur it first.
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(stock)}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 transition-colors ${i === highlight ? "bg-background" : ""}`}
                  >
                    <StockAvatar name={stock.name} logoUrl={stock.logoUrl} className="h-8 w-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-primary">{stock.name}</span>
                      <span className="block truncate text-[11px] font-medium text-subtle">
                        {stock.symbol}
                        {stock.exchange ? ` · ${stock.exchange.toUpperCase()}` : ""}
                        {stock.sector ? ` · ${stock.sector}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status" className="px-4 py-4 text-center text-sm text-muted">
                {message}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
