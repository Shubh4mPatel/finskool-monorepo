"use client";

import Link from "next/link";
import { useState } from "react";
import { dashboardApi, type RegistrationItem, type StatusTone } from "@/lib/dashboard";
import { formatDate } from "@/lib/memberFormat";
import { Avatar } from "@/components/admin/tickets/TicketBadges";
import { Card, EmptyState, PanelError, Pill, SectionHeader, Skeleton } from "./Panel";
import { usePanel } from "./usePanel";

/** "Today, 10:42 am" / "Yesterday" / "23 Oct 2026". */
function formatRegistered(iso: string, now: number): string {
  const d = new Date(iso);
  const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const daysAgo = Math.round((dayStart(now) - dayStart(d.getTime())) / 86_400_000);
  if (daysAgo === 0) {
    return `Today, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase()}`;
  }
  if (daysAgo === 1) return "Yesterday";
  return formatDate(iso);
}

function statusOf(r: RegistrationItem): { label: string; tone: StatusTone } {
  if (r.accountStatus === "suspended") return { label: "Suspended", tone: "danger" };
  if (r.registrationStatus === "pending") return { label: "Pending registration", tone: "warning" };
  return { label: "Active", tone: "success" };
}

export function NewRegistrations({ className = "" }: { className?: string }) {
  const { data, error, loading, retry } = usePanel("registrations", dashboardApi.registrations);
  const [now] = useState(() => Date.now());

  return (
    <Card className={className}>
      <SectionHeader
        title="New registrations"
        subtitle="Latest members to join"
        action={
          <div className="flex items-center gap-3">
            {data && <Pill tone="success">{data.last7DaysCount.toLocaleString("en-IN")} this week</Pill>}
            <Link href="/admin/members" className="text-xs font-bold text-accent transition-colors hover:text-primary">
              View all members →
            </Link>
          </div>
        }
      />

      {error ? (
        <PanelError message={error} onRetry={retry} />
      ) : loading || !data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState>No members have joined yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="bg-background text-[11px] font-bold uppercase tracking-wide text-muted">
                <th className="rounded-l-xl px-3 py-2.5">Member</th>
                <th className="px-3 py-2.5">Email</th>
                <th className="px-3 py-2.5">Registered</th>
                <th className="px-3 py-2.5">Joined via</th>
                <th className="px-3 py-2.5">Community</th>
                <th className="rounded-r-xl px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(r => {
                const status = statusOf(r);
                return (
                  <tr key={r.userId} className="border-b border-divider/70 last:border-0">
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={r.name} className="h-8 w-8" />
                        <span>
                          <span className="block font-bold text-primary">{r.name}</span>
                          <span className="block text-xs text-muted">{r.phone}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted">{r.email ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-primary">{formatRegistered(r.registeredAt, now)}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex whitespace-nowrap rounded-full bg-divider px-2.5 py-0.5 text-[11px] font-bold text-muted">
                        {r.source === "admin" ? "Added by admin" : "Self sign-up"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-primary">{r.communityName ?? "—"}</td>
                    <td className="px-3 py-3">
                      <Pill tone={status.tone}>{status.label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
