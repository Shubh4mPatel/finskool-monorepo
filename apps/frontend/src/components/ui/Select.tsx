"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  /** Leading visual, e.g. a community badge. */
  icon?: ReactNode;
  /** Smaller second line under the label. */
  hint?: string;
}

/** Above this many options the list gets a search box. */
const SEARCH_THRESHOLD = 8;

/**
 * A styled single-select dropdown — a stand-in for a native <select>, whose option list the
 * browser draws and can't be styled. Same keyboard and screen-reader contract as the listbox
 * pattern: ↑/↓/Home/End move, Enter picks, Escape closes and returns focus to the trigger.
 */
export default function Select({
  value,
  onChange,
  options,
  ariaLabel,
  leading,
  triggerClassName = "",
  align = "left",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel: string;
  /** Icon shown inside the trigger, before the selected label. */
  leading?: ReactNode;
  /** Visual style of the trigger button (pill, border, colours). */
  triggerClassName?: string;
  align?: "left" | "right";
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value) ?? options[0];
  const searchable = options.length > SEARCH_THRESHOLD;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function openList() {
    setQuery("");
    setHighlight(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function pick(option: SelectOption) {
    onChange(option.value);
    close();
  }

  // Focus moves into the popup when it opens: the search box if there is one, else the list.
  useEffect(() => {
    if (!open) return;
    (searchable ? searchRef.current : listRef.current)?.focus();
  }, [open, searchable]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function onListKey(e: React.KeyboardEvent) {
    const last = visible.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlight(h => Math.min(last, h + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlight(h => Math.max(0, h - 1));
        break;
      case "Home":
        e.preventDefault();
        setHighlight(0);
        break;
      case "End":
        e.preventDefault();
        setHighlight(last);
        break;
      case "Enter": {
        e.preventDefault();
        const option = visible[highlight];
        if (option) pick(option);
        break;
      }
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  }

  const activeId = open && visible[highlight] ? `${id}-opt-${visible[highlight]!.value || "_"}` : undefined;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        className={`${triggerClassName} pr-9`}
      >
        {leading}
        {selected?.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{selected.icon}</span>}
        <span className="max-w-[12rem] truncate">{selected?.label}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-subtle transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`animate-fade absolute top-full z-50 mt-2 w-max min-w-full max-w-[20rem] overflow-hidden rounded-2xl border border-divider bg-white shadow-card-hover ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {searchable && (
            <div className="border-b border-divider p-2">
              <div className="flex items-center gap-2 rounded-xl bg-background px-3 py-2">
                <Search size={14} className="shrink-0 text-subtle" aria-hidden />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setHighlight(0); }}
                  onKeyDown={onListKey}
                  placeholder="Search…"
                  aria-label={`Search ${ariaLabel.toLowerCase()}`}
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
                />
              </div>
            </div>
          )}

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            aria-activedescendant={activeId}
            tabIndex={-1}
            onKeyDown={onListKey}
            className="max-h-72 overflow-y-auto p-1.5 outline-none scrollbar-slim"
          >
            {visible.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">No matches</li>}
            {visible.map((option, i) => {
              const isSelected = option.value === value;
              const isActive = i === highlight;
              return (
                <li
                  key={option.value || "_"}
                  id={`${id}-opt-${option.value || "_"}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(option)}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                    isActive ? "bg-background" : ""
                  } ${isSelected ? "font-bold text-primary" : "font-medium text-muted"}`}
                >
                  {option.icon && (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background ring-1 ring-divider">
                      {option.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${isActive || isSelected ? "text-primary" : ""}`}>{option.label}</span>
                    {option.hint && <span className="block truncate text-[11px] font-medium text-subtle">{option.hint}</span>}
                  </span>
                  <Check size={15} aria-hidden className={`shrink-0 text-accent transition-opacity ${isSelected ? "opacity-100" : "opacity-0"}`} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
