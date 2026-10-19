import { QUOTE_STATUS_LABEL, statusText } from "@/lib/services";
import type { QuoteStatus, ServiceClosedReason, ServiceRequestStatus } from "@/lib/services";

const REQUEST_STYLE = {
  requested: { pill: "bg-[#fff0f2] text-[#e11d48]", dot: "bg-[#e11d48]" },
  quote_sent: { pill: "bg-[#fff6dc] text-[#a16207]", dot: "bg-[#d99a06]" },
  paid: { pill: "bg-[#e3f4f1] text-accent", dot: "bg-accent" },
  closed: { pill: "bg-[#e4f7ea] text-[#16a34a]", dot: "bg-[#16a34a]" },
  closedMuted: { pill: "bg-[#f1efe6] text-muted", dot: "bg-subtle" },
} as const;

export function RequestStatusBadge({ status, closedReason }: { status: ServiceRequestStatus; closedReason: ServiceClosedReason | null }) {
  // A request that ended without being delivered (declined / cancelled) reads neutral, not "done".
  const style = status === "closed" && closedReason !== "completed" ? REQUEST_STYLE.closedMuted : REQUEST_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${style.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {statusText(status, closedReason)}
    </span>
  );
}

const QUOTE_STYLE: Record<QuoteStatus, string> = {
  active: "bg-[#fff6dc] text-[#a16207]",
  paid: "bg-[#e4f7ea] text-[#16a34a]",
  superseded: "bg-[#f1efe6] text-muted",
  expired: "bg-[#f1efe6] text-muted",
  cancelled: "bg-[#f1efe6] text-muted",
};

export function QuoteStatusPill({ status }: { status: QuoteStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${QUOTE_STYLE[status]}`}>
      {QUOTE_STATUS_LABEL[status]}
    </span>
  );
}
