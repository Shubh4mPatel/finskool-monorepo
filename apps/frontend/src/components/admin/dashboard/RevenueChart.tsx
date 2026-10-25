"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, ChartLine, ChevronDown, Table2, TrendingDown, TrendingUp } from "lucide-react";
import { compactRupees, dashboardApi, longMonth, rupees, shortMonth, type DashboardRevenue } from "@/lib/dashboard";
import { CountUp, useReducedMotion } from "./CountUp";
import { Card, PanelError, Pill, SectionHeader, Skeleton } from "./Panel";
import { usePanel } from "./usePanel";

// Two series: the month in focus (accent) and last month as a de-emphasised comparison. Checked with
// the dataviz palette validator: CVD ΔE 11.6, normal-vision ΔE 16.9. The grey's contrast is 2.4:1,
// so it is never the only carrier — it's dashed, named in the legend, in the tooltip, and in the table.
const ACCENT = "#108b8b";
const COMPARISON = "#a0a89e";
const HAIRLINE = "#ede9e2";
const INK = "#153d3a";
const MONTHS_BACK = 12;
const DRAW_MS = 1200;

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

const withPaise = (n: number) => rupees(n, 2);

function LineKey({ dashed = false }: { dashed?: boolean }) {
  return dashed ? (
    <span className="w-4 border-t-2 border-dashed border-subtle" aria-hidden />
  ) : (
    <span className="h-0.5 w-4 rounded-full bg-accent" aria-hidden />
  );
}

export function RevenueChart({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  const [options] = useState(() => monthOptions(new Date()));
  const [month, setMonth] = useState(() => options[0]!.value);
  const [view, setView] = useState<"chart" | "table">("chart");
  const reducedMotion = useReducedMotion();
  const { data, error, loading, refreshing, retry } = usePanel(`revenue:${month}`, () => dashboardApi.revenue(month));

  const controls = (
    <div className="flex items-center gap-2">
      <label className="relative inline-flex items-center gap-2 rounded-xl border border-divider bg-white py-1.5 pl-3 pr-8 text-xs font-semibold text-primary transition-colors hover:border-subtle focus-within:border-accent">
        <CalendarDays size={14} className="text-muted" aria-hidden />
        <span className="sr-only">Month</span>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="cursor-pointer appearance-none bg-transparent outline-none"
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-muted" aria-hidden />
      </label>
      <div role="group" aria-label="Show revenue as" className="flex rounded-xl bg-background p-0.5">
        {(
          [
            ["chart", ChartLine, "Chart"],
            ["table", Table2, "Table"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            aria-label={label}
            title={label}
            onClick={() => setView(value)}
            className={`flex h-7 w-8 items-center justify-center rounded-lg transition-all duration-200 ${
              view === value ? "bg-white text-primary shadow-sm" : "text-muted hover:text-primary"
            }`}
          >
            <Icon size={14} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );

  const subtitle = data
    ? `1–${data.throughDay} ${shortMonth(data.month)} ${data.month.slice(0, 4)} against 1–${data.previous.length} ${shortMonth(data.previousMonth)} ${data.previousMonth.slice(0, 4)}`
    : "Daily collections, subscriptions and services";

  if (error) {
    return (
      <Card delay={delay} className={className}>
        <SectionHeader title="Revenue" subtitle={subtitle} action={controls} />
        <PanelError message={error} onRetry={retry} />
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card delay={delay} className={className}>
        <SectionHeader title="Revenue" subtitle={subtitle} action={controls} />
        <Skeleton className="h-9 w-52" />
        <Skeleton className="mt-6 h-64 w-full rounded-xl" />
      </Card>
    );
  }

  const points = toChartData(data);
  const last = points.at(-1);
  const delta = data.deltaPercent;
  const animate = !reducedMotion;

  return (
    <Card delay={delay} className={className}>
      <SectionHeader title="Revenue" subtitle={subtitle} action={controls} />

      {/* While a new month loads, hold the previous frame (dimmed) rather than flashing a skeleton. */}
      <div aria-busy={refreshing} className={`transition-opacity duration-300 ${refreshing ? "opacity-50" : "opacity-100"}`}>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <p className="font-display text-[34px] font-bold leading-none tracking-tight text-primary">
            <CountUp key={data.month} value={data.totalCurrent} format={withPaise} duration={DRAW_MS} />
          </p>
          {delta !== null && (
            <Pill tone={delta >= 0 ? "success" : "danger"}>
              {delta >= 0 ? <TrendingUp size={12} aria-hidden /> : <TrendingDown size={12} aria-hidden />}
              {Math.abs(delta)}% vs {shortMonth(data.previousMonth)}
            </Pill>
          )}
          <p className="w-full text-xs text-muted">
            {rupees(data.totalPrevious, 2)} in the same days of {longMonth(data.previousMonth)}
          </p>
        </div>

        {view === "chart" ? (
          <div key={data.month} className="animate-fade">
            <div
              className="mt-5 h-72 w-full"
              role="img"
              aria-label={`Daily revenue for ${longMonth(data.month)}: ${rupees(data.totalCurrent)} collected, compared with ${rupees(data.totalPrevious)} in ${longMonth(data.previousMonth)}. Switch to the table view for every day's figures.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 28, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueWash" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity={0.14} />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={HAIRLINE} strokeWidth={1} />
                  <XAxis
                    dataKey="day"
                    ticks={dayTicks(data.throughDay)}
                    tickLine={false}
                    axisLine={{ stroke: HAIRLINE }}
                    tick={{ fontSize: 11, fill: "#7a8a80" }}
                    tickMargin={10}
                  />
                  <YAxis
                    tickFormatter={compactRupees}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tick={{ fontSize: 11, fill: "#7a8a80" }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ stroke: "#cfc9bd", strokeWidth: 1 }}
                    animationDuration={150}
                    content={({ active, payload }) => {
                      const point = active ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined;
                      if (!point) return null;
                      // Values lead, series names follow; line keys mirror the marks.
                      return (
                        <div className="min-w-40 rounded-xl bg-primary px-3.5 py-2.5 text-white shadow-card-hover">
                          <p className="mb-1.5 text-[11px] font-semibold text-white/60">{formatDay(point.date)}</p>
                          <p className="flex items-center justify-between gap-4">
                            <span className="text-sm font-bold">{rupees(point.current)}</span>
                            <span className="flex items-center gap-1.5 text-[11px] text-white/70">
                              <span className="h-0.5 w-3 rounded-full bg-[#5fd0d0]" aria-hidden />
                              {shortMonth(data.month)}
                            </span>
                          </p>
                          {point.previous !== null && (
                            <p className="mt-1 flex items-center justify-between gap-4">
                              <span className="text-xs font-semibold text-white/80">{rupees(point.previous)}</span>
                              <span className="flex items-center gap-1.5 text-[11px] text-white/60">
                                <span className="w-3 border-t-2 border-dashed border-white/50" aria-hidden />
                                {shortMonth(data.previousMonth)}
                              </span>
                            </p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="previous"
                    stroke={COMPARISON}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fill="none"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={animate}
                    animationDuration={DRAW_MS * 0.8}
                    animationEasing="ease-out"
                  />
                  <Area
                    type="monotone"
                    dataKey="current"
                    stroke={ACCENT}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="url(#revenueWash)"
                    dot={false}
                    activeDot={{ r: 5, fill: ACCENT, stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={animate}
                    animationBegin={120}
                    animationDuration={DRAW_MS}
                    animationEasing="ease-out"
                  />
                  {last && (
                    <ReferenceDot
                      x={last.day}
                      y={last.current}
                      ifOverflow="extendDomain"
                      shape={({ cx, cy }: { cx?: number; cy?: number }) => (
                        // Appears once the line has drawn in: endpoint marker (8px+, surface ring) and
                        // the one direct label on the chart — the latest day's figure.
                        <g className="animate-fade" style={{ animationDelay: `${animate ? DRAW_MS : 0}ms` }}>
                          <circle cx={cx} cy={cy} r={9} fill={ACCENT} opacity={0.15} />
                          <circle cx={cx} cy={cy} r={5} fill={ACCENT} stroke="#fff" strokeWidth={2} />
                          <text
                            x={cx}
                            y={(cy ?? 0) - 14}
                            textAnchor="end"
                            fontSize={11}
                            fontWeight={700}
                            fill={INK}
                          >
                            {rupees(last.current)}
                          </text>
                        </g>
                      )}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex items-center gap-5 text-xs font-medium text-muted">
              <span className="inline-flex items-center gap-2">
                <LineKey />
                {longMonth(data.month)}
              </span>
              <span className="inline-flex items-center gap-2">
                <LineKey dashed />
                {longMonth(data.previousMonth)}
              </span>
            </div>
          </div>
        ) : (
          <div key={`table:${data.month}`} className="animate-fade mt-5 max-h-80 overflow-auto rounded-xl border border-divider scrollbar-slim">
            <table className="w-full text-sm tabular-nums">
              <caption className="sr-only">
                Daily revenue, {longMonth(data.month)} compared with {longMonth(data.previousMonth)}
              </caption>
              <thead className="sticky top-0 bg-background">
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-muted">
                  <th scope="col" className="px-4 py-2.5">Day</th>
                  <th scope="col" className="px-4 py-2.5 text-right">{longMonth(data.month)}</th>
                  <th scope="col" className="px-4 py-2.5 text-right">{longMonth(data.previousMonth)}</th>
                </tr>
              </thead>
              <tbody>
                {points.map(p => (
                  <tr key={p.day} className="border-t border-divider/70 transition-colors hover:bg-background/60">
                    <th scope="row" className="px-4 py-2 text-left font-semibold text-primary">{formatDay(p.date)}</th>
                    <td className="px-4 py-2 text-right text-primary">{rupees(p.current)}</td>
                    <td className="px-4 py-2 text-right text-muted">{p.previous === null ? "—" : rupees(p.previous)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-background">
                <tr className="font-bold text-primary">
                  <th scope="row" className="px-4 py-2.5 text-left">Total</th>
                  <td className="px-4 py-2.5 text-right">{rupees(data.totalCurrent, 2)}</td>
                  <td className="px-4 py-2.5 text-right">{rupees(data.totalPrevious, 2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
