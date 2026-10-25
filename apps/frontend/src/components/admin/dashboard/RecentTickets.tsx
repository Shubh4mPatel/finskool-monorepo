"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Headset, Inbox, Sparkles } from "lucide-react";
import { dashboardApi, type DashboardTicketItem } from "@/lib/dashboard";
import { timeAgo } from "@/lib/tickets";
import { Card, EmptyState, PanelError, Pill, SectionHeader, Skeleton, stagger, TH } from "./Panel";
import { TintAvatar } from "./TintAvatar";
import { usePanel } from "./usePanel";

const detailHref = (t: DashboardTicketItem) => (t.kind === "service" ? `/admin/services/${t.id}` : `/admin/tickets/${t.id}`);

export function RecentTickets({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  const { data, error, loading, retry } = usePanel("tickets", dashboardApi.tickets);
  // Captured once so render stays pure; "15 min ago" is fresh enough for a dashboard glance.
  const [now] = useState(() => Date.now());

  return (
    <Card delay={delay} className={`flex flex-col ${className}`}>
      <SectionHeader
        title="Recent tickets"
        subtitle="Support tickets and service enquiries"
        action={
          <Link
            href="/admin/tickets"
            className="group/link inline-flex items-center gap-1 text-xs font-bold text-accent transition-colors hover:text-primary"
          >
            View all tickets
            <ArrowRight size={13} className="transition-transform duration-200 group-hover/link:translate-x-0.5" />
          </Link>
        }
      />

      {error ? (
        <PanelError message={error} onRetry={retry} />
      ) : loading || !data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={<Inbox size={20} />}>No tickets or service enquiries yet.</EmptyState>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr className="bg-background">
                <th scope="col" className={`${TH} rounded-l-xl`}>Ticket</th>
                <th scope="col" className={TH}>Member</th>
                <th scope="col" className={TH}>Type</th>
                <th scope="col" className={TH}>Subject</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={`${TH} rounded-r-xl text-right`}>Last update</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t, i) => (
                <tr
                  key={`${t.kind}:${t.id}`}
                  style={stagger(i, delay + 150)}
                  className="animate-fade group border-b border-divider/70 transition-colors last:border-0 hover:bg-background/60"
                >
                  <td className="px-3 py-3.5">
                    <Link href={detailHref(t)} className="font-bold tabular-nums text-primary transition-colors hover:text-accent">
                      #{t.label}
                    </Link>
                  </td>
                  <td className="px-3 py-3.5">
                    <span className="flex items-center gap-2.5">
                      <TintAvatar name={t.member.name} className="h-8 w-8" />
                      <span className="font-semibold text-primary">{t.member.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    <span
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        t.kind === "service" ? "bg-violet-50 text-violet-700" : "bg-divider text-muted"
                      }`}
                    >
                      {t.kind === "service" ? <Sparkles size={11} aria-hidden /> : <Headset size={11} aria-hidden />}
                      {t.typeLabel}
                    </span>
                  </td>
                  <td className="max-w-[18rem] px-3 py-3.5">
                    <Link href={detailHref(t)} className="block truncate text-primary transition-colors group-hover:text-accent">
                      {t.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-3.5">
                    <Pill tone={t.status.tone} dot>
                      {t.status.label}
                    </Pill>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-right text-xs text-muted">{timeAgo(t.lastUpdateAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
