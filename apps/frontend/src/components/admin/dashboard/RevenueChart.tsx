"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays } from "lucide-react";
import { compactRupees, dashboardApi, longMonth, rupees, shortMonth, type DashboardRevenue } from "@/lib/dashboard";
import { Card, PanelError, Pill, SectionHeader, Skeleton } from "./Panel";
import { usePanel } from "./usePanel";

const ACCENT = "#108b8b";
const SUBTLE = "#a0a89e";
const DIVIDER = "#ede9e2";
const MONTHS_BACK = 12;

interface ChartPoint {
  day: number;
  date: string;
  current: number;
  previous: number | null;
}

/** The last 12 months, newest first, as YYYY-MM — the server rejects future months. */
function monthOptions(now: Date): { value: string; label: string }[] {
  return Array.from({ length: MONTHS_BACK }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return {
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  });
}

function toChartData(rev: DashboardRevenue): ChartPoint[] {
  return rev.current.map((p, i) => ({
    day: p.day,
    date: p.date,
    current: p.amount,
    previous: rev.previous[i]?.amount ?? null,
  }));
}

/** x-axis labels every 4th day starting at 1 (1, 5, 9 …), like the design. */
const dayTicks = (through: number): number[] => Array.from({ length: Math.ceil(through / 4) }, (_, i) => 1 + i * 4);

function formatDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)} ${shortMonth(`2000-${m}`)}`;
}

export function RevenueChart({ className = "" }: { className?: string }) {
  const [options] = useState(() => monthOptions(new Date()));
  const [month, setMonth] = useState(() => options[0]!.value);
  const { data, error, loading, retry } = usePanel(`revenue:${month}`, () => dashboardApi.revenue(month));

  const monthName = options.find(o => o.value === month)?.label ?? month;
  const picker = (
    <label className="relative inline-flex items-center gap-2 rounded-xl border border-divider bg-white px-3 py-1.5 text-xs font-semibold text-primary">
      <CalendarDays size={14} className="text-muted" aria-hidden />
      <span className="sr-only">Month</span>
      <select
        value={month}
        onChange={e => setMonth(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent pr-1 outline-none"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  const header = (rev: DashboardRevenue | null) => (
    <SectionHeader
      title="Revenue"
      subtitle={
        rev
          ? `1–${rev.throughDay} ${shortMonth(rev.month)} ${rev.month.slice(0, 4)} against 1–${rev.previous.length} ${shortMonth(rev.previousMonth)} ${rev.previousMonth.slice(0, 4)}`
          : monthName
      }
      action={picker}
    />
  );

  if (error) {
    return (
      <Card className={className}>
        {header(null)}
        <PanelError message={error} onRetry={retry} />
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card className={className}>
        {header(null)}
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-4 h-60 w-full" />
      </Card>
    );
  }

  const points = toChartData(data);
  const last = points.at(-1);
  const delta = data.deltaPercent;

  return (
    <Card className={className}>
      {header(data)}

      <div className="flex flex-wrap items-center gap-3">
        <p className="font-display text-3xl font-bold text-primary">{rupees(data.totalCurrent, 2)}</p>
        {delta !== null && (
          <Pill tone={delta >= 0 ? "success" : "danger"}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs {shortMonth(data.previousMonth)}
          </Pill>
        )}
      </div>

      <div
        className="mt-4 h-64 w-full"
        role="img"
        aria-label={`Daily revenue for ${monthName}: ${rupees(data.totalCurrent)} collected, compared with ${rupees(data.totalPrevious)} in ${shortMonth(data.previousMonth)}.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={DIVIDER} />
            <XAxis
              dataKey="day"
              ticks={dayTicks(data.throughDay)}
              tickLine={false}
              axisLine={{ stroke: DIVIDER }}
              tick={{ fontSize: 11, fill: SUBTLE }}
              tickMargin={8}
            />
            <YAxis
              tickFormatter={compactRupees}
              tickLine={false}
              axisLine={false}
              width={44}
              tick={{ fontSize: 11, fill: SUBTLE }}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: ACCENT, strokeDasharray: "3 3", strokeOpacity: 0.5 }}
              content={({ active, payload }) => {
                const point = active ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined;
                if (!point) return null;
                return (
                  <div className="rounded-lg bg-primary px-3 py-2 text-white shadow-card-hover">
                    <p className="text-[11px] text-white/70">{formatDay(point.date)}</p>
                    <p className="text-sm font-bold">{rupees(point.current)}</p>
                    {point.previous !== null && (
                      <p className="text-[11px] text-white/60">
                        {shortMonth(data.previousMonth)}: {rupees(point.previous)}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="previous"
              stroke={SUBTLE}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              fill="none"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="current"
              stroke={ACCENT}
              strokeWidth={2}
              fill="url(#revenueFill)"
              dot={false}
              activeDot={{ r: 5, fill: "#fff", stroke: ACCENT, strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {last && <ReferenceDot x={last.day} y={last.current} r={4} fill={ACCENT} stroke="#fff" strokeWidth={2} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-center gap-5 text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-5 rounded bg-accent" aria-hidden />
          {longMonth(data.month)}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed border-subtle" aria-hidden />
          {longMonth(data.previousMonth)}
        </span>
      </div>
    </Card>
  );
}
