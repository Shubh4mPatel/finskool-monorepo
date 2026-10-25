import type { ReactNode } from "react";
import { TintAvatar } from "@/components/admin/dashboard/TintAvatar";

// Building blocks for the right-hand column of the ticket and service-request pages.

/** A side card with a hairline-divided title strip, like the panels elsewhere in the admin. */
export function SideCard({ title, icon, delay = 0, children }: { title: string; icon?: ReactNode; delay?: number; children: ReactNode }) {
  return (
    <section
      style={{ animationDelay: `${delay}ms` }}
      className="animate-enter rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04]"
    >
      <header className="flex items-center gap-2.5 border-b border-divider px-5 py-3.5">
        {icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">{icon}</span>}
        <h2 className="font-display text-sm font-bold tracking-tight text-primary">{title}</h2>
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-semibold text-primary wrap-break-word">{children}</dd>
    </div>
  );
}

/** The member the page is about: avatar, name and phone. */
export function MemberBlock({ name, phone }: { name: string; phone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-background px-3 py-2.5">
      <TintAvatar name={name} className="h-10 w-10" />
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-primary">{name}</p>
        <p className="text-xs tabular-nums text-muted">{phone}</p>
      </div>
    </div>
  );
}

/** The outlined "secondary" action button used in the page headers and cards. */
export const outlineBtn =
  "flex h-10 items-center justify-center gap-2 rounded-full border border-primary px-5 text-sm font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-40";

/** The solid "primary" action button used in the page headers. */
export const solidBtn =
  "flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
