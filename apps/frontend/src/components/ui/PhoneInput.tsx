"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import RPNInput from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import "react-phone-number-input/style.css";

interface CountryOption {
  value?: string;
  label: string;
}

// Replaces the library's whole country-select unit — native <select> AND the
// flag/arrow around it — since providing `countrySelectComponent` swaps out
// all of it, not just the invisible click-catcher. The native <select>'s
// dropdown is OS-rendered and can't be styled, so this renders its own panel.
function CountrySelect({
  value,
  onChange,
  onFocus,
  onBlur,
  options,
  iconComponent: Icon,
  disabled,
}: {
  value?: string;
  onChange: (value?: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  options: CountryOption[];
  iconComponent: React.ElementType<{ country?: string; label?: string }>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const countries = options.filter((o) => o.value);
  const filtered = query
    ? countries.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : countries;

  function openPanel() {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom + window.scrollY + 6, left: rect.left + window.scrollX });
    setQuery("");
    setOpen(true);
    onFocus?.();
  }

  const closePanel = useCallback(() => {
    setOpen(false);
    onBlur?.();
  }, [onBlur]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node) || panelRef.current?.contains(e.target as Node)) return;
      closePanel();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, closePanel]);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => (open ? closePanel() : openPanel())}
        aria-label="Select country"
        className="PhoneInputCountry cursor-pointer items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="PhoneInputCountryIcon">
          <Icon country={value} label={value} />
        </span>
        <ChevronDown size={13} className={`shrink-0 text-white/90 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "absolute", top: coords.top, left: coords.left }}
            className="z-[60] w-72 overflow-hidden rounded-xl border border-divider bg-white shadow-card-hover"
          >
            <div className="flex items-center gap-2 border-b border-divider px-3 py-2">
              <Search size={14} className="shrink-0 text-subtle" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search country"
                className="w-full border-0 bg-transparent text-sm text-primary outline-none placeholder:text-subtle"
              />
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-sm text-subtle">No matches</p>
              )}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    closePanel();
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-divider/60 ${
                    o.value === value ? "bg-accent/10 font-semibold text-accent" : "text-primary"
                  }`}
                >
                  <span className="PhoneInputCountryIcon shrink-0">
                    <Icon country={o.value} label={o.label} />
                  </span>
                  <span className="flex-1 truncate">{o.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default function PhoneInput({
  value,
  onChange,
  onBlur,
  hasError,
  placeholder = "Enter your phone number",
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  hasError?: boolean;
  placeholder?: string;
}) {
  return (
    <RPNInput
      flags={flags}
      defaultCountry="IN"
      addInternationalOption={false}
      countrySelectComponent={CountrySelect}
      value={value || undefined}
      onChange={(v) => onChange(v ?? "")}
      onBlur={onBlur}
      placeholder={placeholder}
      className={`phone-input-theme flex overflow-hidden rounded-xl border bg-white transition-colors focus-within:border-accent ${
        hasError ? "border-red-400" : "border-[#d6d2c8]"
      }`}
    />
  );
}
