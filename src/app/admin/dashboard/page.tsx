import { ArrowRight, CheckCircle, Clock, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";

const stats = [
  { value: "560", label: "Total Members", icon: Users, iconBg: "bg-accent/10 text-accent", link: "/admin/members" },
  { value: "498", label: "Active Subscriptions", icon: CheckCircle, iconBg: "bg-accent/10 text-accent", link: "/admin/members" },
  { value: "14", label: "Expiring This Week", icon: Clock, iconBg: "bg-amber-100 text-amber-500", link: "/admin/members" },
  { value: "7", label: "Unresolved Threads", icon: MessagesSquare, iconBg: "bg-red-100 text-red-500", link: "/admin/unresolved-threads" },
];

const communities = [
  { name: "Swing Alpha", members: 312, total: 560, color: "bg-primary" },
  { name: "Investor Community", members: 248, total: 560, color: "bg-accent" },
];

const expiringSoon = [
  { name: "Nikhil son", initials: "NS", community: "Swing Alpha", date: "14 Jun 2026" },
  { name: "Ram", initials: "R", community: "Investor", date: "13 Jun 2026" },
  { name: "Raghav sen", initials: "RS", community: "Swing Alpha", date: "20 Jun 2026" },
  { name: "Dev Singh", initials: "DS", community: "Investor", date: "21 Jun 2026" },
];

export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold text-accent">Dashboard</p>
        <h1 className="font-display text-2xl font-bold text-primary">Good Morning, Ritesh 👋</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="animate-rise rounded-2xl bg-white p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${stat.iconBg}`}>
                  <Icon size={18} />
                </div>
                <Link href={stat.link} className="text-xs font-semibold text-accent transition-colors hover:text-primary">
                  View all →
                </Link>
              </div>
              <p className="mt-3 font-display text-3xl font-bold text-primary">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <h2 className="font-display text-base font-bold text-primary">Community Breakdown</h2>
          <p className="mt-0.5 text-xs text-subtle">From 560 subscribed members</p>
          <div className="mt-5 flex flex-col gap-5">
            {communities.map((c) => {
              const pct = Math.round((c.members / c.total) * 100);
              return (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-primary">{c.name}</span>
                    <span className="rounded-full bg-lime/40 px-2.5 py-0.5 text-xs font-bold text-primary">
                      {c.members} members
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-divider">
                    <div
                      className={`h-full rounded-full ${c.color} transition-all duration-700`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-subtle">From 560 subscribed members</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-primary">Expiring Soon</h2>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-600">
              Next 7 Days
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {expiringSoon.map((m) => (
              <div
                key={m.name}
                className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-background"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-primary text-xs font-bold text-lime">
                    {m.initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary">{m.name}</p>
                    <span
                      className={`text-xs font-medium ${
                        m.community === "Swing Alpha" ? "text-accent" : "text-primary/70"
                      }`}
                    >
                      {m.community}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-right">
                  <span className="hidden text-xs text-subtle sm:block">{m.date}</span>
                  <button className="rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent transition-all hover:bg-accent/5">
                    Extend
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/admin/members"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition-colors hover:text-primary"
          >
            View all subscriptions
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
