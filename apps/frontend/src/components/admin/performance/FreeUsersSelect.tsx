"use client";

import { ChevronDown } from "lucide-react";
import type { TradeVisibility } from "@/lib/performance";

const STYLE: Record<TradeVisibility, string> = {
  auto: "bg-divider text-muted",
  show: "bg-emerald-50 text-emerald-700",
  hide: "bg-red-50 text-red-600",
};

const LABEL: Record<TradeVisibility, string> = { auto: "Auto", show: "Show", hide: "Hide" };

/**
 * The per-row "Free users" control. A styled native <select>, not the shared Select: that one's popover is not
 * portalled and would be clipped by the table's horizontal scroll.
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
    <span className="relative inline-flex">
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value as TradeVisibility)}
        className={`cursor-pointer appearance-none rounded-full py-1 pl-3 pr-6 text-[11px] font-bold transition-opacity focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15 disabled:cursor-wait disabled:opacity-60 ${STYLE[value]}`}
      >
        {(Object.keys(LABEL) as TradeVisibility[]).map(v => (
          <option key={v} value={v}>
            {LABEL[v]}
          </option>
        ))}
      </select>
      <ChevronDown size={11} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-70" />
    </span>
  );
}
