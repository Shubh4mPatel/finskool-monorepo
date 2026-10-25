"use client";

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
