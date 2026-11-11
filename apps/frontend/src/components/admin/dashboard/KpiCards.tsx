"use client";

import Link from "next/link";
import { ArrowRight, IndianRupee, Info, ShieldCheck, Ticket, TrendingDown, TrendingUp, Users } from "lucide-react";
import { useId, type ReactNode } from "react";
import { dashboardApi, dayRange, rupees, shortMonth } from "@/lib/dashboard";
import { CountUp } from "./CountUp";
import { Card, PanelError, Pill, Skeleton } from "./Panel";
import { usePanel } from "./usePanel";

const STAGGER_MS = 70;

/**
 * Wraps its children in a keyboard-focusable trigger that explains itself in a small popover on hover or focus (and on
 * tap, which focuses). The card it sits in does not clip, so the popover can hang over the card's edge.
 */
function Tip({ text, children, align = "left" }: { text: string; children: ReactNode; align?: "left" | "right" }) {
  const id = useId();
  return (
    <span className="group/tip relative inline-flex items-center">
      <span
        tabIndex={0}
        aria-describedby={id}
        className="inline-flex cursor-help items-center gap-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {children}
      </span>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none invisible absolute top-full z-40 mt-2 w-64 rounded-xl bg-primary px-3 py-2.5 text-left text-xs font-medium normal-case leading-relaxed tracking-normal text-white opacity-0 shadow-lg transition-opacity duration-150 group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100 ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {text}
      </span>
    </span>
  );
}

/** A label with a small (i) after it; hovering the pair explains what the number counts. */
function ExplainedLabel({ label, text }: { label: string; text: string }) {
  return (
    <Tip text={text}>
      {label}
      <Info size={13} className="text-subtle" aria-hidden />
    </Tip>
  );
}

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
  label: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Card interactive delay={index * STAGGER_MS} className="group flex flex-col hover:z-30 focus-within:z-30">
      {/* Soft corner glow in the card's own hue — depth without a heavy border. It clips itself to the card's corners. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <span
          className={`absolute -right-10 -top-10 h-32 w-32 rounded-full blur-2xl transition-opacity duration-500 group-hover:opacity-100 opacity-70 ${glowClass}`}
        />
      </span>
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
  const unassigned = tickets.unassignedTickets + tickets.unassignedEnquiries;
  const delta = revenue.deltaPercent;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        index={0}
        icon={<Users size={20} />}
        tileClass="bg-gradient-to-br from-primary to-[#245a55] text-white"
        glowClass="bg-primary/10"
        badge={
          <Tip align="right" text="Members who joined since the 1st of this month. Deleted members are not counted.">
            <Pill tone="success">+<CountUp value={totalMembers.newThisMonth} /> this month</Pill>
          </Tip>
        }
        value={<CountUp value={totalMembers.value} />}
        label={
          <ExplainedLabel
            label="Total members"
            text="Every member account that has not been deleted. This includes suspended members and members who have not signed in to the app yet. A member in several communities is counted once."
          />
        }
        footer={<CardLink href="/admin/members">View members</CardLink>}
      />
      <KpiCard
        index={1}
        icon={<ShieldCheck size={20} />}
        tileClass="bg-gradient-to-br from-accent to-[#0b6f6f] text-white"
        glowClass="bg-accent/15"
        badge={
          <Tip
            align="right"
            text="Pending = members added by an admin who have not signed up in the app yet (no password set). They are people, not subscriptions, and are not part of the active subscriptions number."
          >
            <Pill tone="warning">
              <CountUp value={activeSubscriptions.pendingRegistration} /> pending
            </Pill>
          </Tip>
        }
        value={<CountUp value={activeSubscriptions.value} />}
        label={
          <ExplainedLabel
            label="Active subscriptions"
            text="Paid subscriptions that are switched on and have not expired, one per member per community (the free community is not counted). A member in two paid communities counts twice. Only members who have signed up are included."
          />
        }
        footer={<CardLink href="/admin/members">View subscriptions</CardLink>}
      />
      <KpiCard
        index={2}
        icon={<IndianRupee size={20} />}
        tileClass="bg-gradient-to-br from-lime to-[#a6dc4c] text-primary"
        glowClass="bg-lime/40"
        badge={
          delta === null ? null : (
            <Tip
              align="right"
              text={`How much higher or lower this is than the same days of last month (${previousMonthLabel(revenue.from)}), not the whole month.`}
            >
              <Pill tone={delta >= 0 ? "success" : "danger"}>
                {delta >= 0 ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
                {delta >= 0 ? "+" : ""}
                {delta}% vs {previousMonthLabel(revenue.from)}
              </Pill>
            </Tip>
          )
        }
        value={<CountUp value={revenue.amount} format={wholeRupees} />}
        label={
          <ExplainedLabel
            label={`Revenue, ${dayRange(revenue.from, revenue.through)}`}
            text="Money collected from the 1st of this month until today: subscription payments (counted on the day they were paid) and service invoices (counted on the day they were issued). Service income is only included for super admins."
          />
        }
        footer={<span className="font-medium text-muted">Subscriptions and services</span>}
      />
      <KpiCard
        index={3}
        icon={<Ticket size={20} />}
        tileClass="bg-gradient-to-br from-rose-500 to-red-600 text-white"
        glowClass="bg-rose-500/10"
        badge={
          <Tip align="right" text="Everything finished so far, not just this month: resolved tickets plus closed enquiries.">
            <Pill tone="success">
              <CountUp value={tickets.resolved} /> resolved
            </Pill>
          </Tip>
        }
        // Everything still open: support tickets and service enquiries together.
        value={<CountUp value={tickets.openTickets + tickets.openEnquiries} />}
        label={
          <ExplainedLabel
            label="Open tickets & enquiries"
            text="Support tickets that are not resolved yet plus service enquiries that are not closed yet. Tickets are limited to your communities; enquiries are shared by all admins."
          />
        }
        footer={
          unassigned > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-bold text-red-600">
              {/* A live "needs attention" signal — the ping stops under reduced motion (globals.css). */}
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              <Tip text="Unassigned means the ticket or enquiry is still open and no admin has picked it up yet.">{unassigned} unassigned</Tip>
              <span className="font-medium text-muted" aria-hidden>·</span>
              {/* Both pages open on their Unassigned tab. */}
              <Link href="/admin/tickets" className="font-semibold transition-colors hover:text-red-700 hover:underline">
                {tickets.unassignedTickets} {tickets.unassignedTickets === 1 ? "ticket" : "tickets"}
              </Link>
              <Link href="/admin/services" className="font-semibold transition-colors hover:text-red-700 hover:underline">
                {tickets.unassignedEnquiries} {tickets.unassignedEnquiries === 1 ? "enquiry" : "enquiries"}
              </Link>
            </span>
          ) : (
            <span className="font-medium text-emerald-700">Nothing is waiting to be picked up</span>
          )
        }
      />
    </div>
  );
}
