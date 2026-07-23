"use client";

import { useEffect, useState } from "react";
import { ChevronDown, LayoutGrid, Search } from "lucide-react";
import { api } from "@/lib/api";

interface StockRecommendationItem {
  id: string;
  communityId: string;
  symbol: string;
  name: string;
  sector: string | null;
  cmp: number | null;
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  actionCall: "buy" | "hold" | "exit";
  riskLevel: "low" | "medium" | "high";
  recommendationNotes: string | null;
  returnPercent: number | null;
  createdAt: string;
}

const riskStyles: Record<string, string> = {
  low: "text-accent",
  medium: "text-amber-500",
  high: "text-red-500",
};

const riskLabels: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

const callStyles: Record<string, string> = {
  buy: "bg-accent text-white",
  hold: "bg-amber-400 text-white",
  exit: "bg-red-400 text-white",
};

const callLabels: Record<string, string> = { buy: "BUY", hold: "HOLD", exit: "EXIT" };

const AVATAR_COLORS = [
  "bg-orange-100 text-orange-600",
  "bg-blue-100 text-blue-600",
  "bg-purple-100 text-purple-600",
  "bg-lime/40 text-primary",
  "bg-slate-100 text-slate-600",
];

function avatarColor(symbol: string): string {
  return AVATAR_COLORS[symbol.charCodeAt(0) % AVATAR_COLORS.length] ?? "bg-divider text-muted";
}

function formatMoney(n: number | null): string {
  return n == null ? "—" : `₹${n.toLocaleString("en-IN")}`;
}

function formatReturn(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<StockRecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<StockRecommendationItem[]>("/api/v1/stock-recommendations")
      .then(setRecommendations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stats = [
    { value: String(recommendations.length), label: "Total Calls" },
    { value: String(recommendations.length), label: "Active" },
    { value: "—", label: "Avg Return" },
    { value: "—", label: "Win Rate" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">Active Recommendations</h1>
          <p className="mt-1 text-sm text-muted">Stock calls from your admin. Updated in real-time.</p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <button className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95">
              Date
              <ChevronDown size={14} />
            </button>
            <button className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95">
              Sector
              <ChevronDown size={14} />
            </button>
            <button className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white transition-transform duration-300 hover:scale-105 active:scale-95">
              Calls
              <ChevronDown size={14} />
            </button>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-subtle">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            Last updated: just now
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="animate-rise rounded-2xl bg-white p-5 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className="font-display text-2xl font-bold text-primary">
              {stat.value}
            </p>
            <p className="mt-1 text-sm text-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-primary">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white">
              <LayoutGrid size={16} />
            </span>
            All Calls
          </h2>
          <div className="flex w-full items-center gap-2 rounded-full border border-divider px-4 py-2 transition-colors focus-within:border-accent sm:w-auto">
            <Search size={16} className="text-subtle shrink-0" />
            <input
              type="text"
              placeholder="Search stocks…"
              className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none sm:w-40"
            />
          </div>
        </div>

        {loading && (
          <div className="mt-8 flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-divider border-t-accent" />
          </div>
        )}

        {!loading && recommendations.length === 0 && (
          <div className="mt-8 flex flex-col items-center justify-center py-12 text-center">
            <p className="font-semibold text-primary">No recommendations yet</p>
            <p className="mt-1 text-sm text-muted">Your admin hasn&apos;t posted any stock calls for this community yet.</p>
          </div>
        )}

        {/* Mobile / tablet card list */}
        {!loading && recommendations.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 lg:hidden">
            {recommendations.map((row) => (
              <div
                key={row.id}
                className="rounded-xl border border-divider p-4 transition-shadow duration-300 hover:shadow-card"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarColor(row.symbol)}`}>
                      {row.name.slice(0, 1)}
                    </span>
                    <div>
                      <p className="font-semibold text-primary">{row.name}</p>
                      <p className="text-xs text-subtle">{row.sector ?? "Uncategorized"}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${callStyles[row.actionCall]}`}>
                    {callLabels[row.actionCall]}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-subtle">Entry ₹</p>
                    <p className="font-semibold text-primary">{formatMoney(row.entryPrice)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-subtle">CMP ₹</p>
                    <p className="font-semibold text-primary">{formatMoney(row.cmp)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-subtle">Target ₹</p>
                    <p className="font-semibold text-primary">{formatMoney(row.targetPrice)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-subtle">Stop Loss ₹</p>
                    <p className="font-semibold text-primary">{formatMoney(row.stopLossPrice)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-subtle">Return</p>
                    <p className={`font-semibold ${row.returnPercent != null && row.returnPercent < 0 ? "text-red-500" : "text-accent"}`}>
                      {formatReturn(row.returnPercent)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-subtle">Risk</p>
                    <p className={`font-semibold ${riskStyles[row.riskLevel]}`}>{riskLabels[row.riskLevel]}</p>
                  </div>
                </div>

                <p className="mt-3 text-xs text-subtle">Recommended {formatDate(row.createdAt)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Desktop table */}
        {!loading && recommendations.length > 0 && (
          <div className="mt-4 hidden overflow-x-auto lg:block">
            <table className="w-full min-w-225 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold text-subtle">
                  <th className="px-3 py-2">COMPANY</th>
                  <th className="px-3 py-2">SECTOR</th>
                  <th className="px-3 py-2">REC. DATE</th>
                  <th className="px-3 py-2">ENTRY ₹</th>
                  <th className="px-3 py-2">CMP ₹</th>
                  <th className="px-3 py-2">TARGET ₹</th>
                  <th className="px-3 py-2">STOP LOSS ₹</th>
                  <th className="px-3 py-2">RETURN %</th>
                  <th className="px-3 py-2">RISK</th>
                  <th className="px-3 py-2">CALL</th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((row) => (
                  <tr key={row.id} className="border-t border-divider transition-colors hover:bg-background">
                    <td className="flex items-center gap-3 px-3 py-3">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold ${avatarColor(row.symbol)}`}>
                        {row.name.slice(0, 1)}
                      </span>
                      <div>
                        <p className="font-semibold text-primary">{row.name}</p>
                        <p className="text-xs text-subtle">{row.symbol}</p>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{row.sector ?? "—"}</td>
                    <td className="px-3 py-3 text-muted">{formatDate(row.createdAt)}</td>
                    <td className="px-3 py-3 text-muted">{formatMoney(row.entryPrice)}</td>
                    <td className="px-3 py-3 font-semibold text-primary">{formatMoney(row.cmp)}</td>
                    <td className="px-3 py-3 text-muted">{formatMoney(row.targetPrice)}</td>
                    <td className="px-3 py-3 text-muted">{formatMoney(row.stopLossPrice)}</td>
                    <td className={`px-3 py-3 font-semibold ${row.returnPercent != null && row.returnPercent < 0 ? "text-red-500" : "text-accent"}`}>
                      {formatReturn(row.returnPercent)}
                    </td>
                    <td className={`px-3 py-3 font-semibold ${riskStyles[row.riskLevel]}`}>{riskLabels[row.riskLevel]}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${callStyles[row.actionCall]}`}>
                        {callLabels[row.actionCall]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && recommendations.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-subtle">Showing {recommendations.length} recommendation{recommendations.length === 1 ? "" : "s"}</p>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-subtle">
        These are admin recommendations only. Past performance does not guarantee future results. Trade at your own risk.
      </p>
    </div>
  );
}
