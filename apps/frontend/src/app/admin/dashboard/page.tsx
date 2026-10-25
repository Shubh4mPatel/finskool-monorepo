"use client";

import { ExpiringSoon } from "@/components/admin/dashboard/ExpiringSoon";
import { KpiCards } from "@/components/admin/dashboard/KpiCards";
import { NewRegistrations } from "@/components/admin/dashboard/NewRegistrations";
import { RecentTickets } from "@/components/admin/dashboard/RecentTickets";
import { RevenueChart } from "@/components/admin/dashboard/RevenueChart";
import { getSession } from "@/lib/session";

// Each panel loads from its own /api/v1/admin/dashboard/* endpoint (see lib/dashboard.ts),
// so one slow or failing panel never blocks the rest of the page.

function greetingFor(hour: number): string {
  return hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
}

function formatToday(d: Date): string {
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${weekday}, ${date}`;
}

export default function AdminDashboardPage() {
  const adminName = getSession()?.userName?.split(" ")[0] ?? "Admin";
  const today = new Date();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="text-xs font-semibold text-accent">› Dashboard</p>
        {/* Rendered on the server too, where the clock/timezone differ — let the client text win. */}
        <h1 className="font-display text-2xl font-bold text-primary" suppressHydrationWarning>
          {greetingFor(today.getHours())}, {adminName} 👋
        </h1>
        <p className="mt-1 text-sm text-muted" suppressHydrationWarning>
          {formatToday(today)} · Here is what is happening across communities, services and tickets.
        </p>
      </header>

      <KpiCards />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.7fr_1fr]">
        <RevenueChart />
        <ExpiringSoon />
      </div>

      <RecentTickets />
      <NewRegistrations />
    </div>
  );
}
