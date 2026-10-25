"use client";

import Link from "next/link";
import { ArrowRight, CalendarCheck } from "lucide-react";
import { dashboardApi, type StatusTone } from "@/lib/dashboard";
import { formatDate } from "@/lib/memberFormat";
import { Card, EmptyState, PanelError, Pill, SectionHeader, Skeleton, stagger } from "./Panel";
import { TintAvatar } from "./TintAvatar";
import { usePanel } from "./usePanel";

function daysLabel(days: number): string {
  if (days <= 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

const urgency = (days: number): StatusTone => (days <= 2 ? "danger" : "warning");

// Meter: the fill carries severity, the track is a lighter step of the same hue.
const METER: Record<"danger" | "warning", { track: string; fill: string }> = {
  danger: { track: "bg-red-100", fill: "bg-red-500" },
  warning: { track: "bg-amber-100", fill: "bg-amber-500" },
};

export function ExpiringSoon({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  const { data, error, loading, retry } = usePanel("expiring", dashboardApi.expiring);
  const windowDays = data?.windowDays ?? 7;

  return (
    <Card delay={delay} className={`flex flex-col ${className}`}>
      <SectionHeader
        title="Expiring soon"
        subtitle="Subscriptions ending this week"
        action={
          <Pill tone="danger" dot>
            Next {windowDays} days
          </Pill>
        }
      />

      {error ? (
        <PanelError message={error} onRetry={retry} />
      ) : loading || !data ? (
        <div className="space-y-5">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-2.5 w-40" />
              </div>
            </div>
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={<CalendarCheck size={20} />}>Nothing expires in the next {windowDays} days.</EmptyState>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {data.items.map((item, i) => {
            const tone = urgency(item.daysLeft);
            const meter = METER[tone === "danger" ? "danger" : "warning"];
            // How much of the window is left: a full bar is a week away, an empty one is today.
            const left = Math.max(0.06, Math.min(1, item.daysLeft / windowDays));
            return (
              <li
                key={item.subscriptionId}
                style={stagger(i, delay + 150)}
                className="animate-enter flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-background"
              >
                <TintAvatar name={item.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-bold text-primary">{item.name}</p>
                    <Pill tone={tone}>{daysLabel(item.daysLeft)}</Pill>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {item.communityName} · {formatDate(item.validUntil)}
                  </p>
                  <div className={`mt-1.5 h-1 w-full overflow-hidden rounded-full ${meter.track}`} aria-hidden>
                    <div className={`h-full rounded-full ${meter.fill}`} style={{ width: `${left * 100}%` }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.items.length > 0 && (
        <Link
          href="/admin/members"
          className="group/link mt-auto inline-flex items-center justify-center gap-1 pt-4 text-xs font-bold text-accent transition-colors hover:text-primary"
        >
          View all subscriptions{data.total > data.items.length ? ` (${data.total})` : ""}
          <ArrowRight size={13} className="transition-transform duration-200 group-hover/link:translate-x-0.5" />
        </Link>
      )}
    </Card>
  );
}
