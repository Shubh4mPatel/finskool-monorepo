import type { CSSProperties, ReactNode } from "react";
import type { StatusTone } from "@/lib/dashboard";

/** Inline style that staggers an entrance animation: item `index` starts `step` ms after the last. */
export function stagger(index: number, base = 0, step = 55): CSSProperties {
  return { animationDelay: `${base + index * step}ms` };
}

export function Card({
  children,
  className = "",
  delay = 0,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  /** ms before the card's entrance animation starts. */
  delay?: number;
  /** Lifts slightly on hover — for cards that are a single glanceable unit (the KPI tiles). */
  interactive?: boolean;
}) {
  return (
    <section
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-enter relative rounded-2xl bg-white p-5 shadow-card ring-1 ring-primary/[0.04] transition-[transform,box-shadow] duration-300 ${
        interactive ? "hover:-translate-y-0.5 hover:shadow-card-hover" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer rounded-lg bg-[linear-gradient(90deg,var(--color-divider)_0%,#f8f6f0_50%,var(--color-divider)_100%)] bg-[length:200%_100%] ${className}`}
    />
  );
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
export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="animate-fade flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm text-muted">
      {icon && <span className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-subtle">{icon}</span>}
      <p>{children}</p>
    </div>
  );
}

const TONE_STYLE: Record<StatusTone, { pill: string; dot: string }> = {
  danger: { pill: "bg-red-50 text-red-600", dot: "bg-red-500" },
  warning: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  info: { pill: "bg-accent/10 text-accent", dot: "bg-accent" },
  success: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  neutral: { pill: "bg-divider text-muted", dot: "bg-subtle" },
};

export function Pill({ tone, dot = false, children }: { tone: StatusTone; dot?: boolean; children: ReactNode }) {
  const style = TONE_STYLE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${style.pill}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />}
      {children}
    </span>
  );
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-[15px] font-bold tracking-tight text-primary">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A table's header row: quiet, uppercase, rounded ends — shared by both dashboard tables. */
export const TH = "px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted";
