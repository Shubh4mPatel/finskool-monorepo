import type { ReactNode } from "react";
import { getDisplayStatus, type MemberItem } from "@/lib/memberFormat";

/** Text input / select-trigger style for the member forms; `error` turns the field red. */
export const inputCls = (error?: string): string =>
  `w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-primary placeholder:text-subtle transition-all focus:outline-none focus:ring-4 ${
    error ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-divider focus:border-accent focus:ring-accent/10"
  }`;

export function FormField({
  label,
  error,
  children,
  small = false,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
  /** The compact label used inside a nested group. */
  small?: boolean;
}) {
  return (
    <div>
      <label className={small ? "text-xs font-semibold text-muted" : "text-sm font-semibold text-primary"}>{label}</label>
      <div className="mt-1.5">{children}</div>
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}

/** The member's single display status (Registered / Pending / Expired / Suspended / Deleted), with a dot. */
export function StatusPill({ member }: { member: MemberItem }) {
  const status = getDisplayStatus(member);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${status.style}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status.label}
    </span>
  );
}

export const primaryBtn =
  "flex-1 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0";
export const secondaryBtn =
  "flex-1 rounded-full border border-divider bg-white px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50";
