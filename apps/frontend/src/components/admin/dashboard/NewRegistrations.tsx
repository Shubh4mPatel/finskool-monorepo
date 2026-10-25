"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Smartphone, UserPlus, UserRoundCheck } from "lucide-react";
import { dashboardApi, type RegistrationItem, type StatusTone } from "@/lib/dashboard";
import { formatDate } from "@/lib/memberFormat";
import { Card, EmptyState, PanelError, Pill, SectionHeader, Skeleton, stagger, TH } from "./Panel";
import { TintAvatar } from "./TintAvatar";
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

export function NewRegistrations({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  const { data, error, loading, retry } = usePanel("registrations", dashboardApi.registrations);
  const [now] = useState(() => Date.now());

  return (
    <Card delay={delay} className={`flex flex-col ${className}`}>
      <SectionHeader
        title="New registrations"
        subtitle="Latest members to join"
        action={
          <div className="flex items-center gap-3">
            {data && (
              <Pill tone="success" dot>
                {data.last7DaysCount.toLocaleString("en-IN")} this week
              </Pill>
            )}
            <Link
              href="/admin/members"
              className="group/link inline-flex items-center gap-1 text-xs font-bold text-accent transition-colors hover:text-primary"
            >
              View all members
              <ArrowRight size={13} className="transition-transform duration-200 group-hover/link:translate-x-0.5" />
            </Link>
          </div>
        }
      />

      {error ? (
        <PanelError message={error} onRetry={retry} />
      ) : loading || !data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState icon={<UserPlus size={20} />}>No members have joined yet.</EmptyState>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead>
              <tr className="bg-background">
                <th scope="col" className={`${TH} rounded-l-xl`}>Member</th>
                <th scope="col" className={TH}>Email</th>
                <th scope="col" className={TH}>Registered</th>
                <th scope="col" className={TH}>Joined via</th>
                <th scope="col" className={TH}>Community</th>
                <th scope="col" className={`${TH} rounded-r-xl`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r, i) => {
                const status = statusOf(r);
                const viaAdmin = r.source === "admin";
                return (
                  <tr
                    key={r.userId}
                    style={stagger(i, delay + 150)}
                    className="animate-fade border-b border-divider/70 transition-colors last:border-0 hover:bg-background/60"
                  >
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-3">
                        <TintAvatar name={r.name} />
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-primary">{r.name}</span>
                          <span className="block text-xs tabular-nums text-muted">{r.phone}</span>
                        </span>
                      </span>
                    </td>
                    <td className="max-w-[14rem] truncate px-3 py-3 text-muted">{r.email ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-primary">{formatRegistered(r.registeredAt, now)}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          viaAdmin ? "bg-divider text-muted" : "bg-sky-50 text-sky-700"
                        }`}
                      >
                        {viaAdmin ? <UserRoundCheck size={11} aria-hidden /> : <Smartphone size={11} aria-hidden />}
                        {viaAdmin ? "Added by admin" : "Self sign-up"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium text-primary">{r.communityName ?? <span className="text-subtle">—</span>}</td>
                    <td className="px-3 py-3">
                      <Pill tone={status.tone} dot>
                        {status.label}
                      </Pill>
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
