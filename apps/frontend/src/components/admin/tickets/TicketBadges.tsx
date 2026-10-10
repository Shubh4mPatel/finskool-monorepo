import type { TicketStatus } from "@/lib/tickets";
import { STATUS_LABEL } from "@/lib/tickets";

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-amber-100 text-amber-700",
  in_progress: "bg-accent/10 text-accent",
  resolved: "bg-[#4caf50]/10 text-[#2e7d32]",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
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
