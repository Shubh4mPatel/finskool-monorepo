"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle, Clock, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { getSession } from "@/lib/session";

interface DashboardStats {
  totalMembers: number;
  activeSubscriptions: number;
  pendingRegistration: number;
  expiringThisWeek: number;
  unresolvedThreads: number;
}

interface CommunityBreakdownItem {
  communityId: string;
  communityName: string;
  memberCount: number;
  registeredCount: number;
  registrationPercentage: number;
}

interface ExpiringSoonItem {
  userId: string;
  name: string;
  initials: string;
  communityId: string;
  communityName: string;
  validUntil: string;
  daysLeft: number;
}

interface DashboardData {
  stats: DashboardStats;
  communityBreakdown: CommunityBreakdownItem[];
  expiringSoon: ExpiringSoonItem[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function urgencyClass(days: number): string {
  if (days <= 2) return "bg-red-100 text-red-600";
  if (days <= 4) return "bg-orange-100 text-orange-600";
  return "bg-amber-100 text-amber-600";
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const session = getSession();
  const adminName = session?.userName?.split(" ")[0] ?? "Admin";

  useEffect(() => {
    api.get<DashboardData>("/api/v1/admin/dashboard")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  const totalSubscribed = data?.communityBreakdown.reduce((s, c) => s + c.memberCount, 0) ?? 0;

  const statCards = [
    {
      value: data?.stats.totalMembers ?? "—",
      label: "Total Members",
      sub: null,
      icon: Users,
      iconBg: "bg-accent/10 text-accent",
      link: "/admin/members",
    },
    {
      value: data?.stats.activeSubscriptions ?? "—",
      label: "Active Subscriptions",
      sub: data ? `${data.stats.pendingRegistration} pending registration` : null,
      icon: CheckCircle,
      iconBg: "bg-accent/10 text-accent",
      link: "/admin/members",
    },
    {
      value: data?.stats.expiringThisWeek ?? "—",
      label: "Expiring This Week",
      sub: null,
      icon: Clock,
      iconBg: "bg-amber-100 text-amber-500",
      link: "/admin/members",
    },
    {
      value: data?.stats.unresolvedThreads ?? "—",
      label: "Unresolved Threads",
      sub: null,
      icon: MessagesSquare,
      iconBg: "bg-red-100 text-red-500",
      link: "/admin/unresolved-threads",
    },
  ];

  const barColors = ["bg-primary", "bg-accent", "bg-lime-500", "bg-amber-400"];

  return (
    <div className="flex flex-col gap-5">
      {/* Heading */}
      <div>
        <p className="text-xs font-semibold text-accent">› Dashboard</p>
        <h1 className="font-display text-2xl font-bold text-primary">{greeting}, {adminName} 👋</h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-2xl bg-white p-5 shadow-card">
              <div className="flex items-start justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${stat.iconBg}`}>
                  <Icon size={16} />
                </div>
                <Link href={stat.link} className="text-xs font-semibold text-accent transition-colors hover:text-primary">
                  View all →
                </Link>
              </div>
              <p className="mt-3 font-display text-3xl font-bold text-primary">
                {loading ? <span className="inline-block h-8 w-16 animate-pulse rounded-lg bg-divider" /> : stat.value}
              </p>
              <p className="mt-0.5 text-xs text-muted">{stat.label}</p>
              {stat.sub && <p className="mt-0.5 text-[11px] text-subtle">{stat.sub}</p>}
            </div>
          );
        })}
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* Community Breakdown */}
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <h2 className="text-sm font-bold text-primary">Community Breakdown</h2>

          {loading ? (
            <div className="mt-4 space-y-5">
              {[0, 1].map(i => (
                <div key={i} className="space-y-2">
                  <div className="h-4 w-40 animate-pulse rounded bg-divider" />
                  <div className="h-2 w-full animate-pulse rounded-full bg-divider" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-5">
                {(data?.communityBreakdown ?? []).map((c, i) => (
                  <div key={c.communityId}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-primary">{c.communityName}</span>
                      <span className="shrink-0 rounded-full bg-lime px-2.5 py-0.5 text-xs font-bold text-primary">
                        {c.memberCount} members
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-divider">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${barColors[i] ?? "bg-primary"}`}
                          style={{ width: `${c.registrationPercentage}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-medium text-subtle">
                        {c.registrationPercentage}%
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-subtle">
                      {c.registeredCount} registered of {c.memberCount} total
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs text-subtle">Total: {totalSubscribed} subscribed members</p>
            </>
          )}
        </div>

        {/* Expiring Soon */}
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-primary">Expiring Soon</h2>
            <span className="rounded-full bg-lime px-3 py-0.5 text-xs font-semibold text-primary">
              Next 7 Days
            </span>
          </div>

          {loading ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-divider" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-28 animate-pulse rounded bg-divider" />
                    <div className="h-2.5 w-20 animate-pulse rounded bg-divider" />
                  </div>
                </div>
              ))}
            </div>
          ) : (data?.expiringSoon ?? []).length === 0 ? (
            <p className="mt-4 text-sm text-subtle">No subscriptions expiring in the next 7 days.</p>
          ) : (
            <div className="mt-4 flex flex-col gap-1">
              {(data?.expiringSoon ?? []).map(m => (
                <div
                  key={m.userId + m.communityId}
                  className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-background"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                      {m.initials}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-primary">{m.name}</p>
                      <span className="text-xs font-medium text-accent">{m.communityName}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="hidden text-xs text-subtle sm:block">{formatDate(m.validUntil)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${urgencyClass(m.daysLeft)}`}>
                      {m.daysLeft} days
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Link
            href="/admin/members"
            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-primary"
          >
            View all subscriptions <ArrowRight size={13} />
          </Link>
        </div>

      </div>
    </div>
  );
}
