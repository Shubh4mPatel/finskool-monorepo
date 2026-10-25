"use client";

import Link from "next/link";
import { ArrowRight, IndianRupee, ShieldCheck, Ticket, TrendingDown, TrendingUp, Users } from "lucide-react";
import type { ReactNode } from "react";
import { dashboardApi, dayRange, rupees, shortMonth } from "@/lib/dashboard";
import { CountUp } from "./CountUp";
import { Card, PanelError, Pill, Skeleton } from "./Panel";
import { usePanel } from "./usePanel";

const STAGGER_MS = 70;

function KpiCard({
  index,
  icon,
  tileClass,
  glowClass,
  badge,
  value,
  label,
  footer,
}: {
  index: number;
  icon: ReactNode;
  tileClass: string;
  glowClass: string;
  badge: ReactNode;
  value: ReactNode;
  label: string;
  footer: ReactNode;
}) {
  return (
    <Card interactive delay={index * STAGGER_MS} className="group flex flex-col overflow-hidden">
      {/* Soft corner glow in the card's own hue — depth without a heavy border. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl transition-opacity duration-500 group-hover:opacity-100 opacity-70 ${glowClass}`}
      />
      <div className="relative flex items-start justify-between gap-2">
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-105 ${tileClass}`}
        >
          {icon}
        </span>
        {badge}
      </div>
      <p className="relative mt-5 font-display text-[32px] font-bold leading-none tracking-tight text-primary">{value}</p>
      <p className="relative mt-2 text-sm font-medium text-muted">{label}</p>
      <div className="relative mt-5 border-t border-divider pt-3 text-xs">{footer}</div>
    </Card>
  );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group/link inline-flex items-center gap-1 font-bold text-accent transition-colors hover:text-primary"
    >
      {children}
      <ArrowRight size={13} className="transition-transform duration-200 group-hover/link:translate-x-0.5" />
    </Link>
  );
}

/** "Sep" for a window starting in October. */
function previousMonthLabel(from: string): string {
  const [y, m] = from.split("-").map(Number);
  const prev = m === 1 ? `${(y ?? 1970) - 1}-12` : `${y}-${String((m ?? 1) - 1).padStart(2, "0")}`;
  return shortMonth(prev);
}

const wholeRupees = (n: number) => rupees(Math.round(n));

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
          <Card key={i} delay={i * STAGGER_MS}>
            <Skeleton className="h-11 w-11 rounded-xl" />
            <Skeleton className="mt-5 h-8 w-28" />
            <Skeleton className="mt-3 h-3 w-32" />
            <Skeleton className="mt-6 h-3 w-24" />
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
        index={0}
        icon={<Users size={20} />}
        tileClass="bg-gradient-to-br from-primary to-[#245a55] text-white"
        glowClass="bg-primary/10"
        badge={<Pill tone="success">+<CountUp value={totalMembers.newThisMonth} /> this month</Pill>}
        value={<CountUp value={totalMembers.value} />}
        label="Total members"
        footer={<CardLink href="/admin/members">View members</CardLink>}
      />
      <KpiCard
        index={1}
        icon={<ShieldCheck size={20} />}
        tileClass="bg-gradient-to-br from-accent to-[#0b6f6f] text-white"
        glowClass="bg-accent/15"
        badge={
          <Pill tone="warning">
            <CountUp value={activeSubscriptions.pendingRegistration} /> pending
          </Pill>
        }
        value={<CountUp value={activeSubscriptions.value} />}
        label="Active subscriptions"
        footer={<CardLink href="/admin/members">View subscriptions</CardLink>}
      />
      <KpiCard
        index={2}
        icon={<IndianRupee size={20} />}
        tileClass="bg-gradient-to-br from-lime to-[#a6dc4c] text-primary"
        glowClass="bg-lime/40"
        badge={
          delta === null ? null : (
            <Pill tone={delta >= 0 ? "success" : "danger"}>
              {delta >= 0 ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
              {delta >= 0 ? "+" : ""}
              {delta}% vs {previousMonthLabel(revenue.from)}
            </Pill>
          )
        }
        value={<CountUp value={revenue.amount} format={wholeRupees} />}
        label={`Revenue, ${dayRange(revenue.from, revenue.through)}`}
        footer={<span className="font-medium text-muted">Subscriptions and services</span>}
      />
      <KpiCard
        index={3}
        icon={<Ticket size={20} />}
        tileClass="bg-gradient-to-br from-rose-500 to-red-600 text-white"
        glowClass="bg-rose-500/10"
        badge={
          <Pill tone="info">
            <CountUp value={tickets.openEnquiries} /> enquiries
          </Pill>
        }
        value={<CountUp value={tickets.openTickets} />}
        label="Open tickets"
        footer={
          tickets.awaitingFirstReply > 0 ? (
            <Link
              href="/admin/tickets"
              className="inline-flex items-center gap-2 font-bold text-red-600 transition-colors hover:text-red-700"
            >
              {/* A live "needs attention" signal — the ping stops under reduced motion (globals.css). */}
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              {tickets.awaitingFirstReply} awaiting first reply
            </Link>
          ) : (
            <span className="font-medium text-emerald-700">Everyone has had a first reply</span>
          )
        }
      />
    </div>
  );
}
