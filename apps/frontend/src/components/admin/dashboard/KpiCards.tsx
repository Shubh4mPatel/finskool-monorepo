"use client";

import Link from "next/link";
import { IndianRupee, ShieldCheck, Ticket, Users } from "lucide-react";
import type { ReactNode } from "react";
import { dashboardApi, dayRange, rupees, shortMonth } from "@/lib/dashboard";
import { Card, PanelError, Pill, Skeleton } from "./Panel";
import { usePanel } from "./usePanel";

function KpiCard({
  icon,
  iconClass,
  badge,
  value,
  label,
  footer,
}: {
  icon: ReactNode;
  iconClass: string;
  badge: ReactNode;
  value: string;
  label: string;
  footer: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconClass}`}>{icon}</span>
        {badge}
      </div>
      <p className="mt-4 font-display text-3xl font-bold text-primary">{value}</p>
      <p className="mt-0.5 text-sm text-muted">{label}</p>
      <div className="mt-4 border-t border-divider pt-3 text-xs">{footer}</div>
    </Card>
  );
}

const linkClass = "font-bold text-accent transition-colors hover:text-primary";

export function KpiCards() {
  const { data, error, loading, retry } = usePanel("kpis", dashboardApi.kpis);

  if (error) {
    return (
      <Card>
        <PanelError message={error} onRetry={retry} />
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <Card key={i}>
            <Skeleton className="h-10 w-10" />
            <Skeleton className="mt-4 h-8 w-24" />
            <Skeleton className="mt-2 h-3 w-32" />
            <Skeleton className="mt-6 h-3 w-28" />
          </Card>
        ))}
      </div>
    );
  }

  const { totalMembers, activeSubscriptions, revenue, tickets } = data;
  const delta = revenue.deltaPercent;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={<Users size={18} />}
        iconClass="bg-primary text-white"
        badge={<Pill tone="success">+{totalMembers.newThisMonth.toLocaleString("en-IN")} this month</Pill>}
        value={totalMembers.value.toLocaleString("en-IN")}
        label="Total members"
        footer={
          <Link href="/admin/members" className={linkClass}>
            View members →
          </Link>
        }
      />
      <KpiCard
        icon={<ShieldCheck size={18} />}
        iconClass="bg-accent text-white"
        badge={<Pill tone="warning">{activeSubscriptions.pendingRegistration.toLocaleString("en-IN")} pending</Pill>}
        value={activeSubscriptions.value.toLocaleString("en-IN")}
        label="Active subscriptions"
        footer={
          <Link href="/admin/members" className={linkClass}>
            View subscriptions →
          </Link>
        }
      />
      <KpiCard
        icon={<IndianRupee size={18} />}
        iconClass="bg-lime text-primary"
        badge={
          delta === null ? null : (
            <Pill tone={delta >= 0 ? "success" : "danger"}>
              {delta >= 0 ? "+" : ""}
              {delta}% vs {previousMonthLabel(revenue.from)}
            </Pill>
          )
        }
        value={rupees(revenue.amount)}
        label={`Revenue, ${dayRange(revenue.from, revenue.through)}`}
        footer={<span className="text-muted">Subscriptions and services</span>}
      />
      <KpiCard
        icon={<Ticket size={18} />}
        iconClass="bg-red-500 text-white"
        badge={<Pill tone="info">{tickets.openEnquiries.toLocaleString("en-IN")} enquiries</Pill>}
        value={tickets.openTickets.toLocaleString("en-IN")}
        label="Open tickets"
        footer={
          tickets.awaitingFirstReply > 0 ? (
            <Link href="/admin/tickets" className="font-bold text-red-600 transition-colors hover:text-red-700">
              {tickets.awaitingFirstReply} awaiting first reply
            </Link>
          ) : (
            <span className="text-muted">Everyone has had a first reply</span>
          )
        }
      />
    </div>
  );
}

/** "Sep" for a window starting in October. */
function previousMonthLabel(from: string): string {
  const [y, m] = from.split("-").map(Number);
  const prev = m === 1 ? `${(y ?? 1970) - 1}-12` : `${y}-${String((m ?? 1) - 1).padStart(2, "0")}`;
  return shortMonth(prev);
}
