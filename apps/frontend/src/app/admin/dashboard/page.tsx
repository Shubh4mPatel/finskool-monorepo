"use client";

import Link from "next/link";
import { CalendarDays, Plus, Upload } from "lucide-react";
import { ExpiringSoon } from "@/components/admin/dashboard/ExpiringSoon";
import { KpiCards } from "@/components/admin/dashboard/KpiCards";
import { NewRegistrations } from "@/components/admin/dashboard/NewRegistrations";
import { RecentTickets } from "@/components/admin/dashboard/RecentTickets";
import { RevenueChart } from "@/components/admin/dashboard/RevenueChart";
import { useSession } from "@/lib/session";

// Each panel loads from its own /api/v1/admin/dashboard/* endpoint (see lib/dashboard.ts),
// so one slow or failing panel never blocks the rest of the page. Panels enter in reading
// order — header, KPI row, chart + expiring, then the two tables — via staggered delays (ms).

function greetingFor(hour: number): string {
  return hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
}

function formatToday(d: Date): string {
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${weekday}, ${date}`;
}

export default function AdminDashboardPage() {
  const adminName = useSession()?.userName?.split(" ")[0] ?? "Admin";
  const today = new Date();

  return (
    <div className="flex flex-col gap-5">
      <header className="animate-enter flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-accent">› Dashboard</p>
          {/* Rendered on the server too, where the clock/timezone differ — let the client text win. */}
          <h1 className="mt-1 font-display text-[26px] font-bold tracking-tight text-primary" suppressHydrationWarning>
            {greetingFor(today.getHours())}, {adminName} <span className="animate-wave">👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted">Here is what is happening across communities, services and tickets.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="hidden items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-semibold text-primary shadow-card ring-1 ring-primary/[0.04] sm:inline-flex"
            suppressHydrationWarning
          >
            <CalendarDays size={14} className="text-accent" aria-hidden />
            {formatToday(today)}
          </span>
          <Link
            href="/admin/import-csv"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-primary shadow-card ring-1 ring-primary/[0.06] transition-all hover:-translate-y-px hover:shadow-card-hover"
          >
            <Upload size={14} aria-hidden />
            Import members
          </Link>
          <Link
            href="/admin/create-post"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-[0_8px_20px_-10px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
          >
            <Plus size={14} className="text-lime" aria-hidden />
            Create post
          </Link>
        </div>
      </header>

      <KpiCards />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.7fr_1fr]">
        <RevenueChart delay={300} />
        <ExpiringSoon delay={380} />
      </div>

      <RecentTickets delay={460} />
      <NewRegistrations delay={540} />
    </div>
  );
}
