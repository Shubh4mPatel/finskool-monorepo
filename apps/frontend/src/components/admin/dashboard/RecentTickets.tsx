"use client";

import Link from "next/link";
import { useState } from "react";
import { dashboardApi, type DashboardTicketItem } from "@/lib/dashboard";
import { timeAgo } from "@/lib/tickets";
import { Avatar } from "@/components/admin/tickets/TicketBadges";
import { Card, EmptyState, PanelError, Pill, SectionHeader, Skeleton } from "./Panel";
import { usePanel } from "./usePanel";

const detailHref = (t: DashboardTicketItem) => (t.kind === "service" ? `/admin/services/${t.id}` : `/admin/tickets/${t.id}`);

export function RecentTickets({ className = "" }: { className?: string }) {
  const { data, error, loading, retry } = usePanel("tickets", dashboardApi.tickets);
  // Captured once so render stays pure; "15 min ago" is fresh enough for a dashboard glance.
  const [now] = useState(() => Date.now());

  return (
    <Card className={className}>
      <SectionHeader
        title="Recent tickets"
        subtitle="Support tickets and service enquiries"
        action={
          <Link href="/admin/tickets" className="text-xs font-bold text-accent transition-colors hover:text-primary">
            View all tickets →
          </Link>
        }
      />

      {error ? (
        <PanelError message={error} onRetry={retry} />
      ) : loading || !data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState>No tickets or service enquiries yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="bg-background text-[11px] font-bold uppercase tracking-wide text-muted">
                <th className="rounded-l-xl px-3 py-2.5">Ticket</th>
                <th className="px-3 py-2.5">Member</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Subject</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="rounded-r-xl px-3 py-2.5 text-right">Last update</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(t => (
                <tr key={`${t.kind}:${t.id}`} className="border-b border-divider/70 last:border-0">
                  <td className="px-3 py-3 font-bold text-primary">
                    <Link href={detailHref(t)} className="hover:text-accent hover:underline">
                      #{t.label}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={t.member.name} className="h-7 w-7" />
                      <span className="font-semibold text-primary">{t.member.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                        t.kind === "service" ? "bg-violet-50 text-violet-600" : "bg-divider text-muted"
                      }`}
                    >
                      {t.typeLabel}
                    </span>
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-3 text-primary">{t.subject}</td>
                  <td className="px-3 py-3">
                    <Pill tone={t.status.tone}>{t.status.label}</Pill>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-xs text-muted">{timeAgo(t.lastUpdateAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
