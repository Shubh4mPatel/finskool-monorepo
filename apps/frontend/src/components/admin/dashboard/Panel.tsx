import type { ReactNode } from "react";
import type { StatusTone } from "@/lib/dashboard";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-white p-5 shadow-card ${className}`}>{children}</section>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-divider ${className}`} />;
}

export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 py-4 text-sm text-muted">
      <p>{message}</p>
      <button type="button" onClick={onRetry} className="text-xs font-bold text-accent hover:underline">
        Try again
      </button>
    </div>
  );
}

/** Shown when a panel loaded fine but has nothing to list — centered in the space the list would use. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

const TONE_STYLE: Record<StatusTone, string> = {
  danger: "bg-red-50 text-red-600",
  warning: "bg-amber-50 text-amber-600",
  info: "bg-accent/10 text-accent",
  success: "bg-emerald-50 text-emerald-700",
  neutral: "bg-divider text-muted",
};

export function Pill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${TONE_STYLE[tone]}`}>
      {children}
    </span>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-base font-bold text-primary">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
