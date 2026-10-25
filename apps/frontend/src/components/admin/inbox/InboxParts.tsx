"use client";

import type { ReactNode } from "react";
import { CountUp } from "@/components/admin/dashboard/CountUp";

/** Keyboard focus ring shared by the inbox pages' filter controls. */
export const focusRing = "focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15";

/**
 * A counter tile that doubles as a shortcut into the matching tab. Used by the support-ticket and
 * service-enquiry inboxes.
 */
export function StatTile({
  icon,
  iconClass,
  label,
  value,
  caption,
  captionClass,
  active,
  onClick,
  delay,
}: {
  icon: ReactNode;
  iconClass: string;
  label: string;
  value: number | undefined;
  caption: string;
  captionClass: string;
  active: boolean;
  onClick: () => void;
  delay: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-enter group flex items-start gap-4 rounded-2xl bg-white p-5 text-left shadow-card ring-1 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover ${focusRing} ${
        active ? "ring-accent/40" : "ring-primary/[0.04]"
      }`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105 ${iconClass}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-muted">{label}</span>
        <span className="mt-1 block font-display text-[28px] font-bold leading-none tracking-tight text-primary">
          {value === undefined ? "–" : <CountUp value={value} />}
        </span>
        <span className={`mt-2 block text-xs font-semibold ${captionClass}`}>{caption}</span>
      </span>
    </button>
  );
}

/** One option of a segmented tab control; `alert` is for a tab that needs attention (e.g. "Needs review"). */
export function TabButton({
  active,
  label,
  count,
  onClick,
  alert = false,
}: {
  active: boolean;
  label: string;
  count?: number | undefined;
  onClick: () => void;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all duration-200 ${
        active ? "bg-white text-primary shadow-sm" : alert ? "text-red-600 hover:text-red-700" : "text-muted hover:text-primary"
      }`}
    >
      {label}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 text-[10px] tabular-nums ${
            active ? "bg-lime text-primary" : alert ? "bg-red-100 text-red-600" : "bg-divider text-muted"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
