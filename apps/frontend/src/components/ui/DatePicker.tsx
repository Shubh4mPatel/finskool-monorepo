"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, CalendarDays, X } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { formatDisplayDate, parseDateParam, toDateParam } from "@/lib/dates";
import { pillClass } from "./Select";

export interface DatePreset {
  label: string;
  date: Date;
}

const GAP = 8;
const MARGIN = 8;

/**
 * A date picker: a trigger that opens a calendar popover. Values are `YYYY-MM-DD` strings (or "" for none).
 *
 * The popover is portalled to <body> and positioned against the trigger, so it is never clipped by a
 * scrolling dialog or a table's overflow; it flips above the trigger when there is no room below, and
 * closes on Escape, an outside click, or any scroll/resize. Month and year are dropdowns, so a date
 * years away is two clicks, not a hundred.
 */
export default function DatePicker({
  value,
  onChange,
  variant = "field",
  label,
  placeholder = "Select date",
  ariaLabel,
  triggerClassName = "",
  minDate,
  presets,
  clearable = variant === "pill",
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** `field` fills a form row like an input; `pill` is a compact toolbar filter. */
  variant?: "field" | "pill";
  /** Pill only: the filter's name, shown before the value. */
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Extra classes for the trigger, e.g. the form-field style or an error border. */
  triggerClassName?: string;
  /** Earlier days are shown but can't be picked. */
  minDate?: Date;
  /** Quick picks shown under the calendar. */
  presets?: DatePreset[];
  clearable?: boolean;
  autoFocus?: boolean;
}) {
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const selected = parseDateParam(value);
  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  function pick(date: Date | undefined) {
    onChange(date ? toDateParam(date) : "");
    close();
  }

  // Place the popover before first paint — set straight on the element, so there is no flash and no extra render.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const t = trigger.getBoundingClientRect();
    const { width, height } = popover.getBoundingClientRect();
    const below = window.innerHeight - t.bottom - GAP - MARGIN;
    const above = t.top - GAP - MARGIN;
    const top = height > below && above > below ? Math.max(MARGIN, t.top - GAP - height) : t.bottom + GAP;
    const left = Math.min(Math.max(MARGIN, t.left), window.innerWidth - width - MARGIN);
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    // A scroll anywhere else would leave the popover floating away from its trigger.
    const onScroll = (e: Event) => {
      if (!popoverRef.current?.contains(e.target as Node)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("mousedown", onPointer);
    // Capture, so a parent dialog's own Escape handler doesn't also close the dialog.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  // The month/year dropdowns must reach the selected date, however far away it is.
  const startMonth = new Date(Math.min(selected?.getFullYear() ?? 2015, 2015), 0);
  const endMonth = new Date(Math.max(selected?.getFullYear() ?? 2040, 2040), 11);

  const display = selected ? formatDisplayDate(selected) : "";
  const trigger =
    variant === "pill" ? (
      <button
        ref={triggerRef}
        type="button"
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={`${pillClass(!!value)} ${clearable && value ? "pr-9" : ""} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15 ${triggerClassName}`}
      >
        <Calendar size={14} />
        {label && <span className={value ? "text-xs font-bold" : ""}>{label}</span>}
        {display && <span className="font-semibold text-primary">{display}</span>}
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? label ?? placeholder}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex items-center justify-between gap-2 text-left ${triggerClassName}`}
      >
        <span className={display ? "text-primary" : "text-subtle"}>{display || placeholder}</span>
        <CalendarDays size={15} className="shrink-0 text-subtle" aria-hidden />
      </button>
    );

  return (
    // A form field fills its row; a toolbar pill only takes the width of its content, so pills sit side by side.
    <div className={variant === "pill" ? "relative inline-flex shrink-0 items-center" : "relative flex w-full items-center"}>
      <div className={variant === "pill" ? "relative flex items-center" : "w-full"}>
        {trigger}
        {variant === "pill" && clearable && value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={`Clear ${label ?? "date"}`}
            className="absolute right-2.5 flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-white hover:text-primary"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label={ariaLabel ?? label ?? "Choose a date"}
            // Position is applied in the layout effect above; start offscreen-safe at the origin.
            style={{ top: 0, left: 0 }}
            className="rdp-theme animate-fade fixed z-[70] rounded-2xl bg-white p-3 shadow-card-hover ring-1 ring-primary/[0.06]"
          >
            <DayPicker
              mode="single"
              selected={selected}
              onSelect={pick}
              defaultMonth={selected ?? minDate}
              captionLayout="dropdown"
              startMonth={startMonth}
              endMonth={endMonth}
              {...(minDate ? { disabled: { before: minDate } } : {})}
              autoFocus
            />
            {(presets?.length || (clearable && value)) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-divider pt-3">
                {presets?.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    title={formatDisplayDate(p.date)}
                    onClick={() => pick(p.date)}
                    className="rounded-full border border-divider bg-white px-3 py-1 text-xs font-semibold text-muted transition-colors hover:border-accent hover:bg-accent/5 hover:text-accent"
                  >
                    {p.label}
                  </button>
                ))}
                {clearable && value && (
                  <button
                    type="button"
                    onClick={() => pick(undefined)}
                    className="ml-auto rounded-full px-3 py-1 text-xs font-semibold text-subtle transition-colors hover:text-primary"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
