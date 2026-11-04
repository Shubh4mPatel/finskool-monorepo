"use client";

import type { TradeVisibility } from "@/lib/performance";
import Select, { type SelectOption } from "@/components/ui/Select";

const STYLE: Record<TradeVisibility, string> = {
  auto: "bg-divider text-muted",
  show: "bg-emerald-50 text-emerald-700",
  hide: "bg-red-50 text-red-600",
};

const OPTIONS: SelectOption[] = [
  { value: "auto", label: "Auto", hint: "Follows the board's rules" },
  { value: "show", label: "Show", hint: "Always visible to free members" },
  { value: "hide", label: "Hide", hint: "Never visible to free members" },
];

/**
 * The per-row "Free users" control: the site's own dropdown, drawn on the page (portal) so the table's horizontal
 * scroll cannot clip its list. The pill takes the colour of the choice: grey Auto, green Show, red Hide.
 */
export function FreeUsersSelect({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: TradeVisibility;
  disabled?: boolean;
  onChange: (value: TradeVisibility) => void;
  ariaLabel: string;
}) {
  return (
    <Select
      value={value}
      onChange={v => onChange(v as TradeVisibility)}
      options={OPTIONS}
      ariaLabel={ariaLabel}
      portal
      compact
      searchable={false}
      disabled={disabled}
      className="inline-flex"
      triggerClassName={`relative flex items-center gap-1 rounded-full py-1 pl-3 text-[11px] font-bold transition-opacity focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15 disabled:cursor-wait disabled:opacity-60 ${STYLE[value]}`}
    />
  );
}
