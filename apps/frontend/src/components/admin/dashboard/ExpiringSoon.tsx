"use client";

import Link from "next/link";
import { dashboardApi } from "@/lib/dashboard";
import { formatDate } from "@/lib/memberFormat";
import { Avatar } from "@/components/admin/tickets/TicketBadges";
import { Card, EmptyState, PanelError, Pill, SectionHeader, Skeleton } from "./Panel";
import { usePanel } from "./usePanel";

function daysLabel(days: number): string {
  if (days <= 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function urgencyClass(days: number): string {
  if (days <= 2) return "bg-red-50 text-red-600";
  if (days <= 4) return "bg-orange-50 text-orange-600";
  return "bg-amber-50 text-amber-600";
}

export function ExpiringSoon({ className = "" }: { className?: string }) {
  const { data, error, loading, retry } = usePanel("expiring", dashboardApi.expiring);

  return (
    <Card className={`flex flex-col ${className}`}>
      <SectionHeader
        title="Expiring soon"
        subtitle="Subscriptions ending this week"
        action={<Pill tone="danger">Next {data?.windowDays ?? 7} days</Pill>}
      />

      {error ? (
        <PanelError message={error} onRetry={retry} />
      ) : loading || !data ? (
        <div className="space-y-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-2.5 w-36" />
              </div>
            </div>
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState>Nothing expires in the next {data.windowDays} days.</EmptyState>
      ) : (
        <ul className="flex flex-col">
          {data.items.map(item => (
            <li key={item.subscriptionId} className="flex items-center gap-3 border-b border-divider/70 py-3 last:border-0">
              <Avatar name={item.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-primary">{item.name}</p>
                <p className="truncate text-xs text-muted">
                  {item.communityName} · {formatDate(item.validUntil)}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${urgencyClass(item.daysLeft)}`}>
                {daysLabel(item.daysLeft)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <Link
          href="/admin/members"
          className="mt-auto pt-4 text-center text-xs font-bold text-accent transition-colors hover:text-primary"
        >
          View all subscriptions{data.total > data.items.length ? ` (${data.total})` : ""} →
        </Link>
      )}
    </Card>
  );
}
