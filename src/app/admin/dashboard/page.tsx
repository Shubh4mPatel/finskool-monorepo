import { ArrowRight, CheckCircle, Clock, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";

const stats = [
  { value: "560", label: "Total Members", sub: null, icon: Users, iconBg: "bg-accent/10 text-accent", link: "/admin/members" },
  { value: "498", label: "Active Subscriptions", sub: "92 pending registration", icon: CheckCircle, iconBg: "bg-accent/10 text-accent", link: "/admin/members" },
  { value: "14", label: "Expiring This Week", sub: null, icon: Clock, iconBg: "bg-amber-100 text-amber-500", link: "/admin/members" },
  { value: "7", label: "Unresolved Threads", sub: null, icon: MessagesSquare, iconBg: "bg-red-100 text-red-500", link: "/admin/unresolved-threads" },
];

const communities = [
  { name: "Swing Alpha", members: 312, total: 560, color: "bg-primary" },
  { name: "Investor Community", members: 248, total: 560, color: "bg-accent" },
];

const expiringSoon = [
  { name: "Nikhil son", initials: "NS", community: "Swing Alpha", communityColor: "text-accent", date: "14 Jun 2026", daysLeft: 2, urgency: "bg-red-100 text-red-600" },
  { name: "Ram", initials: "R", community: "Investor", communityColor: "text-primary/60", date: "13 Jun 2026", daysLeft: 3, urgency: "bg-orange-100 text-orange-600" },
  { name: "Raghav sen", initials: "RS", community: "Swing Alpha", communityColor: "text-accent", date: "20 Jun 2026", daysLeft: 4, urgency: "bg-orange-100 text-orange-600" },
  { name: "Dev Singh", initials: "DS", community: "Investor", communityColor: "text-primary/60", date: "21 Jun 2026", daysLeft: 3, urgency: "bg-orange-100 text-orange-600" },
];

export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-5">
      {/* Breadcrumb + heading */}
      <div>
        <p className="text-xs font-semibold text-accent">› Dashboard</p>
        <h1 className="font-display text-2xl font-bold text-primary">Good Morning, Ritesh 👋</h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-2xl bg-white p-5 shadow-card">
              <div className="flex items-start justify-between">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full ${stat.iconBg}`}>
                  <Icon size={16} />
                </div>
                <Link href={stat.link} className="text-xs font-semibold text-accent hover:text-primary">
                  View all →
                </Link>
              </div>
              <p className="mt-3 font-display text-3xl font-bold text-primary">{stat.value}</p>
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
          <div className="mt-4 flex flex-col gap-5">
            {communities.map((c) => {
              const pct = Math.round((c.members / c.total) * 100);
              return (
                <div key={c.name}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-primary">{c.name}</span>
                    <span className="rounded-full bg-lime px-2.5 py-0.5 text-xs font-bold text-primary">
                      {c.members} members
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-divider">
                      <div className={`h-full rounded-full ${c.color}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-8 text-right text-xs text-subtle">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-xs text-subtle">Total: 560 subscribed members</p>
        </div>

        {/* Expiring Soon */}
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-primary">Expiring Soon</h2>
            <span className="rounded-full bg-lime px-3 py-0.5 text-xs font-semibold text-primary">
              Next 7 Days
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-1">
            {expiringSoon.map((m) => (
              <div
                key={m.name}
                className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-background"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                    {m.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary">{m.name}</p>
                    <span className={`text-xs font-medium ${m.communityColor}`}>{m.community}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden text-xs text-subtle sm:block">{m.date}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${m.urgency}`}>
                    {m.daysLeft} days
                  </span>
                  <button className="rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/5">
                    Extend
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/admin/members"
            className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-primary"
          >
            View all subscriptions <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}
