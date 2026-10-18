import type { TicketStatus } from "@/lib/tickets";
import { STATUS_LABEL } from "@/lib/tickets";

// pill background / text, and the leading dot colour
const STATUS_STYLE: Record<TicketStatus, { pill: string; dot: string }> = {
  open: { pill: "bg-[#fff0f2] text-[#e11d48]", dot: "bg-[#e11d48]" },
  in_progress: { pill: "bg-[#e3f4f1] text-accent", dot: "bg-accent" },
  resolved: { pill: "bg-[#e4f7ea] text-[#16a34a]", dot: "bg-[#16a34a]" },
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${style.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Avatar({ name, dark = false, className = "h-8 w-8" }: { name: string; dark?: boolean; className?: string }) {
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${className} ${
        dark ? "bg-primary text-white" : "bg-[#dff1ee] text-accent"
      }`}
    >
      {initials}
    </span>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-divider px-2.5 py-0.5 text-[11px] font-semibold text-muted">{children}</span>;
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="text-sm tracking-wide text-amber-500" aria-label={`${value} out of 5`}>
      {"★".repeat(value)}
      <span className="text-divider">{"★".repeat(5 - value)}</span>
    </span>
  );
}
