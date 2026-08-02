"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useMarketStatus, useLiveCmpAndReturn } from "@/store/liveStockPrices/hooks";

interface Community { id: string; name: string; slug: string; memberCount: number }

interface StockOption {
  id: string;
  name: string;
  symbol: string;
  sector: string | null;
  exchange: "nse" | "bse" | null;
  cmp: number | null;
}

interface StockRecommendationItem {
  id: string;
  communityId: string;
  recommendedBy: string;
  stockId: string;
  symbol: string;
  name: string;
  sector: string | null;
  exchange: "nse" | "bse" | null;
  cmp: number | null;
  entryPrice: number;
  targetPrice: number;
  stopLossPrice: number;
  actionCall: "buy" | "hold" | "exit";
  riskLevel: "low" | "medium" | "high";
  recommendationNotes: string | null;
  returnPercent: number | null;
  createdAt: string;
  updatedAt: string;
}

const RISK_OPTIONS: { value: "low" | "medium" | "high"; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const CALL_OPTIONS: { value: "buy" | "hold" | "exit"; label: string }[] = [
  { value: "buy", label: "BUY" },
  { value: "hold", label: "HOLD" },
  { value: "exit", label: "EXIT" },
];

const RISK_STYLES: Record<string, string> = { low: "text-accent", medium: "text-amber-500", high: "text-red-500" };
const RISK_LABELS: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const CALL_STYLES: Record<string, string> = { buy: "bg-accent text-white", hold: "bg-amber-400 text-white", exit: "bg-red-400 text-white" };
const CALL_LABELS: Record<string, string> = { buy: "BUY", hold: "HOLD", exit: "EXIT" };

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

const EMPTY_RECOMMENDATION = {
  communityIds: [] as string[],
  stockId: "",
  entryPrice: "",
  targetPrice: "",
  stopLossPrice: "",
  riskLevel: "" as "" | "low" | "medium" | "high",
  actionCall: "buy" as "buy" | "hold" | "exit",
  recommendationNotes: "",
};
type RecommendationField = keyof typeof EMPTY_RECOMMENDATION;
type RecommendationErrors = Partial<Record<RecommendationField, string>>;

function validateRecommendation(f: typeof EMPTY_RECOMMENDATION): RecommendationErrors {
  const e: RecommendationErrors = {};
  if (f.communityIds.length === 0) e.communityIds = "Select at least one community";
  if (!f.stockId) e.stockId = "Search and select a company";
  const entry = parseFloat(f.entryPrice);
  if (!f.entryPrice || isNaN(entry) || entry <= 0) e.entryPrice = "Enter a valid entry price";
  const target = parseFloat(f.targetPrice);
  if (!f.targetPrice || isNaN(target) || target <= 0) e.targetPrice = "Enter a valid target price";
  const stopLoss = parseFloat(f.stopLossPrice);
  if (!f.stopLossPrice || isNaN(stopLoss) || stopLoss <= 0) e.stopLossPrice = "Enter a valid stop loss price";
  if (!f.riskLevel) e.riskLevel = "Select a risk level";
  return e;
}

type ModalType = "add" | "edit" | null;

interface RecommendationRowProps {
  rec: StockRecommendationItem;
  communityName: string;
  onEdit: (rec: StockRecommendationItem) => void;
  onDelete: (rec: StockRecommendationItem) => void;
  deletingId: string | null;
}

function AdminRecommendationCard({ rec, communityName, onEdit, onDelete, deletingId }: RecommendationRowProps) {
  const { cmp, returnPercent, isLive } = useLiveCmpAndReturn(rec);

  return (
    <div className="rounded-xl border border-divider p-4 transition-shadow hover:shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarColor(rec.symbol)}`}>
            {rec.name.slice(0, 1)}
          </span>
          <div>
            <p className="font-semibold text-primary">{rec.name}</p>
            <p className="text-xs text-subtle">
              {rec.symbol}{rec.exchange ? ` · ${rec.exchange.toUpperCase()}` : ""} &middot; {communityName}
            </p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${CALL_STYLES[rec.actionCall]}`}>
          {CALL_LABELS[rec.actionCall]}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <div><p className="text-xs text-subtle">Entry ₹</p><p className="font-semibold text-primary">{formatMoney(rec.entryPrice)}</p></div>
        <div>
          <p className="flex items-center gap-1 text-xs text-subtle">
            CMP ₹{isLive && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}
          </p>
          <p className="font-semibold text-primary">{formatMoney(cmp)}</p>
        </div>
        <div><p className="text-xs text-subtle">Target ₹</p><p className="font-semibold text-primary">{formatMoney(rec.targetPrice)}</p></div>
        <div><p className="text-xs text-subtle">Stop Loss ₹</p><p className="font-semibold text-primary">{formatMoney(rec.stopLossPrice)}</p></div>
        <div>
          <p className="text-xs text-subtle">Return</p>
          <p className={`font-semibold ${returnPercent == null ? "text-muted" : returnPercent < 0 ? "text-red-500" : "text-accent"}`}>
            {formatReturn(returnPercent)}
          </p>
        </div>
        <div><p className="text-xs text-subtle">Risk</p><p className={`font-semibold ${RISK_STYLES[rec.riskLevel]}`}>{RISK_LABELS[rec.riskLevel]}</p></div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-divider pt-3">
        <p className="text-xs text-subtle">Recommended {formatDate(rec.createdAt)}</p>
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(rec)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent" title="Edit"><Pencil size={13} /></button>
          <button onClick={() => onDelete(rec)} disabled={deletingId === rec.id} className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500" title="Delete"><Trash2 size={13} /></button>
        </div>
      </div>
    </div>
  );
}

function AdminRecommendationRow({ rec, communityName, onEdit, onDelete, deletingId }: RecommendationRowProps) {
  const { cmp, returnPercent, isLive } = useLiveCmpAndReturn(rec);

  return (
    <tr className="border-t border-divider transition-colors hover:bg-background">
      <td className="px-3 py-3">
        <div className="flex items-center gap-3">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-bold ${avatarColor(rec.symbol)}`}>
            {rec.name.slice(0, 1)}
          </span>
          <div>
            <p className="font-semibold text-primary">{rec.name}</p>
            <p className="text-xs text-subtle">
              {rec.exchange ? rec.exchange.toUpperCase() : rec.symbol} &middot; {communityName}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 text-muted">{rec.sector ?? "—"}</td>
      <td className="px-3 py-3 text-muted">{formatMoney(rec.entryPrice)}</td>
      <td className="px-3 py-3 font-semibold text-primary">
        <span className="flex items-center gap-1.5">
          {formatMoney(cmp)}
          {isLive && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}
        </span>
      </td>
      <td className="px-3 py-3 text-muted">{formatMoney(rec.targetPrice)}</td>
      <td className="px-3 py-3 text-muted">{formatMoney(rec.stopLossPrice)}</td>
      <td className={`px-3 py-3 font-semibold ${returnPercent == null ? "text-muted" : returnPercent < 0 ? "text-red-500" : "text-accent"}`}>
        {formatReturn(returnPercent)}
      </td>
      <td className={`px-3 py-3 font-semibold ${RISK_STYLES[rec.riskLevel]}`}>{RISK_LABELS[rec.riskLevel]}</td>
      <td className="px-3 py-3">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${CALL_STYLES[rec.actionCall]}`}>{CALL_LABELS[rec.actionCall]}</span>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(rec)} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-accent">
            <Pencil size={14} />
          </button>
          <button onClick={() => onDelete(rec)} disabled={deletingId === rec.id} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function AdminStockRecommendationsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const marketStatus = useMarketStatus();

  const [communities, setCommunities] = useState<Community[]>([]);
  const [recommendations, setRecommendations] = useState<StockRecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCommunity, setFilterCommunity] = useState("");
  const [search, setSearch] = useState("");
  const [filterRisk, setFilterRisk] = useState("");
  const [filterCall, setFilterCall] = useState("");
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const [modal, setModal] = useState<ModalType>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<StockRecommendationItem | null>(null);
  const [form, setForm] = useState(EMPTY_RECOMMENDATION);
  const [errors, setErrors] = useState<RecommendationErrors>({});
  const [touched, setTouched] = useState<Partial<Record<RecommendationField, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Company search (Add mode only — immutable once created)
  const [stockQuery, setStockQuery] = useState("");
  const [debouncedStockQuery, setDebouncedStockQuery] = useState("");
  const [stockOptions, setStockOptions] = useState<StockOption[]>([]);
  const [selectedStock, setSelectedStock] = useState<StockOption | null>(null);
  const [stockDropdownOpen, setStockDropdownOpen] = useState(false);
  const [stockSearching, setStockSearching] = useState(false);
  const stockFieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<Community[]>("/api/v1/admin/communities")
      .then(setCommunities)
      .catch(() => {});
  }, []);

  // Fetch every accessible recommendation once — community filtering happens
  // client-side so the community cards can show every community's own counts
  // at the same time, regardless of which one is currently selected.
  useEffect(() => {
    setLoading(true);
    api.get<StockRecommendationItem[]>("/api/v1/stock-recommendations")
      .then(setRecommendations)
      .catch(err => toast.error(err instanceof ApiError ? err.message : "Failed to load recommendations"))
      .finally(() => setLoading(false));
  // toast is a stable context ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTrigger]);

  // Debounce the company search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedStockQuery(stockQuery), 300);
    return () => clearTimeout(t);
  }, [stockQuery]);

  // Fetch matching stocks while the dropdown is open (Add mode only)
  useEffect(() => {
    if (modal !== "add" || !stockDropdownOpen) return;
    setStockSearching(true);
    api.get<StockOption[]>(`/api/v1/stocks?search=${encodeURIComponent(debouncedStockQuery)}`)
      .then(setStockOptions)
      .catch(() => setStockOptions([]))
      .finally(() => setStockSearching(false));
  }, [debouncedStockQuery, stockDropdownOpen, modal]);

  // Close the suggestion dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (stockFieldRef.current && !stockFieldRef.current.contains(e.target as Node)) {
        setStockDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const refresh = () => setFetchTrigger(t => t + 1);

  function close() {
    setModal(null);
    setSelectedRecommendation(null);
    setForm(EMPTY_RECOMMENDATION);
    setErrors({});
    setTouched({});
    setStockQuery("");
    setStockOptions([]);
    setSelectedStock(null);
    setStockDropdownOpen(false);
  }

  function openAddModal() {
    setForm(EMPTY_RECOMMENDATION);
    setErrors({});
    setTouched({});
    setStockQuery("");
    setSelectedStock(null);
    setModal("add");
  }

  function openEditModal(rec: StockRecommendationItem) {
    setSelectedRecommendation(rec);
    setForm({
      communityIds: [rec.communityId],
      stockId: rec.stockId,
      entryPrice: String(rec.entryPrice),
      targetPrice: String(rec.targetPrice),
      stopLossPrice: String(rec.stopLossPrice),
      riskLevel: rec.riskLevel,
      actionCall: rec.actionCall,
      recommendationNotes: rec.recommendationNotes ?? "",
    });
    setErrors({});
    setTouched({});
    setModal("edit");
  }

  function blurField(field: RecommendationField) {
    setTouched(t => ({ ...t, [field]: true }));
    setErrors(e => ({ ...e, [field]: validateRecommendation(form)[field] }));
  }

  function changeField(field: RecommendationField, value: string) {
    const updated = { ...form, [field]: value };
    setForm(updated);
    if (touched[field]) setErrors(e => ({ ...e, [field]: validateRecommendation(updated)[field] }));
  }

  function toggleCommunity(id: string) {
    const communityIds = form.communityIds.includes(id)
      ? form.communityIds.filter(c => c !== id)
      : [...form.communityIds, id];
    const updated = { ...form, communityIds };
    setForm(updated);
    if (touched.communityIds) setErrors(e => ({ ...e, communityIds: validateRecommendation(updated).communityIds }));
  }

  function changeStockQuery(value: string) {
    setStockQuery(value);
    setStockDropdownOpen(true);
    if (form.stockId) setForm(f => ({ ...f, stockId: "" }));
    setSelectedStock(null);
  }

  function selectStock(s: StockOption) {
    setSelectedStock(s);
    setForm(f => ({ ...f, stockId: s.id }));
    setStockQuery(s.name);
    setStockDropdownOpen(false);
    setErrors(e => ({ ...e, stockId: undefined }));
  }

  async function handleAddRecommendation() {
    const errs = validateRecommendation(form);
    setTouched({ communityIds: true, stockId: true, entryPrice: true, targetPrice: true, stopLossPrice: true, riskLevel: true });
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setSubmitting(true);
    try {
      await api.post("/api/v1/stock-recommendations", {
        communityIds: form.communityIds,
        stockId: form.stockId,
        entryPrice: parseFloat(form.entryPrice),
        targetPrice: parseFloat(form.targetPrice),
        stopLossPrice: parseFloat(form.stopLossPrice),
        riskLevel: form.riskLevel,
        actionCall: form.actionCall,
        ...(form.recommendationNotes.trim() && { recommendationNotes: form.recommendationNotes.trim() }),
      });
      toast.success({ title: "Recommendation added", message: `${selectedStock?.name ?? "Stock"} call is now live.` });
      close();
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add recommendation");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateRecommendation() {
    if (!selectedRecommendation) return;
    const errs = validateRecommendation(form);
    delete errs.communityIds;
    delete errs.stockId;
    setTouched(t => ({ ...t, entryPrice: true, targetPrice: true, stopLossPrice: true, riskLevel: true }));
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;

    setSubmitting(true);
    try {
      const updated = await api.patch<StockRecommendationItem>(`/api/v1/stock-recommendations/${selectedRecommendation.id}`, {
        entryPrice: parseFloat(form.entryPrice),
        targetPrice: parseFloat(form.targetPrice),
        stopLossPrice: parseFloat(form.stopLossPrice),
        riskLevel: form.riskLevel,
        actionCall: form.actionCall,
        recommendationNotes: form.recommendationNotes.trim(),
      });
      setRecommendations(prev => prev.map(r => (r.id === updated.id ? updated : r)));
      toast.success({ title: "Recommendation updated", message: `${updated.name} has been updated.` });
      close();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update recommendation");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteRecommendation(rec: StockRecommendationItem) {
    const ok = await confirm({
      title: "Delete Recommendation?",
      message: `This will remove the ${rec.symbol} call from members' view. This can't be undone from here.`,
      confirmLabel: "Yes, Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeletingId(rec.id);
    try {
      await api.delete(`/api/v1/stock-recommendations/${rec.id}`);
      toast.success({ title: "Recommendation deleted", message: `${rec.name} is no longer visible to members.` });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete recommendation");
    } finally {
      setDeletingId(null);
    }
  }

  function communityName(id: string): string {
    return communities.find(c => c.id === id)?.name ?? "—";
  }

  function activeCallsFor(communityId: string): number {
    return recommendations.filter(r => r.communityId === communityId && r.actionCall !== "exit").length;
  }

  const filtered = recommendations
    .filter(r => !filterCommunity || r.communityId === filterCommunity)
    .filter(r => !filterRisk || r.riskLevel === filterRisk)
    .filter(r => !filterCall || r.actionCall === filterCall)
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.symbol.toLowerCase().includes(search.toLowerCase()));

  const totalCalls = filtered.length;
  const activeCalls = filtered.filter(r => r.actionCall !== "exit").length;
  const withReturn = filtered.filter(r => r.returnPercent != null);
  const avgReturn = withReturn.length > 0
    ? withReturn.reduce((sum, r) => sum + (r.returnPercent ?? 0), 0) / withReturn.length
    : null;
  const winRate = withReturn.length > 0
    ? (withReturn.filter(r => (r.returnPercent ?? 0) > 0).length / withReturn.length) * 100
    : null;

  const stats = [
    { value: String(totalCalls), label: "Total Calls" },
    { value: String(activeCalls), label: "Active" },
    { value: avgReturn == null ? "—" : formatReturn(avgReturn), label: "Avg Return", positive: avgReturn != null && avgReturn >= 0 },
    { value: winRate == null ? "—" : `${winRate.toFixed(0)}%`, label: "Win Rate" },
  ];

  const fieldCls = (err?: string, isSelect?: boolean) =>
    `mt-2 w-full rounded-xl border bg-white py-2.5 text-sm placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 ${
      isSelect ? "appearance-none cursor-pointer pl-4 pr-9" : "px-4"
    } ${
      err ? "border-red-400 focus:ring-red-200" : "border-divider focus:ring-accent/40"
    }`;

  const selectCls = "appearance-none rounded-full border border-divider bg-white pl-4 pr-9 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary focus:outline-none";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Stock Recommendation</p>
          <h1 className="font-display text-2xl font-bold text-primary">Stock Recommendations</h1>
          <p className="mt-1 text-sm text-muted">Manage active recommendations for each community.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
            style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
          >
            <Plus size={14} />
            Add Stock
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-subtle">
        <span className={`h-1.5 w-1.5 rounded-full ${marketStatus.open ? "bg-accent animate-pulse" : "bg-subtle"}`} />
        {marketStatus.open === null ? "Connecting…" : marketStatus.open ? "Market live — CMP updates in real time" : "Market closed"}
      </div>

      {/* Community cards */}
      {communities.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {communities.map(c => {
            const active = filterCommunity === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setFilterCommunity(prev => (prev === c.id ? "" : c.id))}
                className={`flex flex-col items-start gap-1 rounded-2xl px-5 py-4 text-left transition-colors ${
                  active ? "bg-primary text-white shadow-glow" : "border border-divider bg-white text-primary hover:border-accent"
                }`}
              >
                <span className="font-display text-base font-bold">{c.name}</span>
                <span className={`text-xs ${active ? "text-white/80" : "text-muted"}`}>
                  {c.memberCount} member{c.memberCount === 1 ? "" : "s"} &middot; {activeCallsFor(c.id)} active call{activeCallsFor(c.id) === 1 ? "" : "s"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat, i) => (
          <div
            key={stat.label}
            className="animate-rise rounded-2xl bg-white p-5 text-center shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <p className={`font-display text-2xl font-bold ${stat.positive ? "text-accent" : "text-primary"}`}>
              {stat.value}
            </p>
            <p className="mt-1 text-sm text-muted">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-card sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-full border border-divider bg-white px-4 py-2 transition-colors focus-within:border-accent sm:flex-none">
            <Search size={15} className="shrink-0 text-subtle" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by company or symbol..."
              className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none sm:w-52"
            />
          </div>

          <div className="relative shrink-0">
            <select value={filterRisk} onChange={e => setFilterRisk(e.target.value)} className={selectCls}>
              <option value="">All Risk Levels</option>
              {RISK_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-subtle" />
          </div>

          <div className="relative shrink-0">
            <select value={filterCall} onChange={e => setFilterCall(e.target.value)} className={selectCls}>
              <option value="">All Calls</option>
              {CALL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-subtle" />
          </div>

        </div>

        {loading && (
          <div className="mt-8 flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-divider border-t-accent" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="mt-8 flex flex-col items-center justify-center py-12 text-center">
            <p className="font-semibold text-primary">No recommendations yet</p>
            <p className="mt-1 text-sm text-muted">Add your first stock call to get started.</p>
          </div>
        )}

        {/* Mobile card list */}
        {!loading && filtered.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 lg:hidden">
            {filtered.map(rec => (
              <AdminRecommendationCard
                key={rec.id}
                rec={rec}
                communityName={communityName(rec.communityId)}
                onEdit={openEditModal}
                onDelete={handleDeleteRecommendation}
                deletingId={deletingId}
              />
            ))}
          </div>
        )}

        {/* Desktop table */}
        {!loading && filtered.length > 0 && (
          <div className="mt-4 hidden overflow-x-auto lg:block">
            <table className="w-full min-w-225 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase text-subtle">
                  <th className="px-3 py-3">Company</th>
                  <th className="px-3 py-3">Sector</th>
                  <th className="px-3 py-3">Entry ₹</th>
                  <th className="px-3 py-3">CMP ₹</th>
                  <th className="px-3 py-3">Target ₹</th>
                  <th className="px-3 py-3">Stop Loss ₹</th>
                  <th className="px-3 py-3">Return %</th>
                  <th className="px-3 py-3">Risk</th>
                  <th className="px-3 py-3">Call</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(rec => (
                  <AdminRecommendationRow
                    key={rec.id}
                    rec={rec}
                    communityName={communityName(rec.communityId)}
                    onEdit={openEditModal}
                    onDelete={handleDeleteRecommendation}
                    deletingId={deletingId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {(modal === "add" || modal === "edit") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4 backdrop-blur-sm">
          <div className="animate-rise w-full max-w-lg rounded-2xl bg-white p-6 shadow-card-hover">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-primary">
                {modal === "add" ? "New Recommendation" : "Edit Recommendation"}
              </h3>
              <button onClick={close} className="rounded-full p-1 text-subtle transition-colors hover:bg-divider/60 hover:text-primary"><X size={18} /></button>
            </div>

            <div className="mt-5 flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
              {modal === "add" ? (
                <div>
                  <label className="text-sm font-semibold text-primary">Communities</label>
                  <div className="mt-2 flex flex-wrap gap-2" onBlur={() => blurField("communityIds")}>
                    {communities.map(c => (
                      <button key={c.id} type="button"
                        onClick={() => toggleCommunity(c.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
                          form.communityIds.includes(c.id)
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-divider text-muted hover:border-accent hover:text-accent"
                        }`}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                  {errors.communityIds && <p className="mt-1 text-xs text-red-500">{errors.communityIds}</p>}
                </div>
              ) : (
                <div>
                  <label className="text-sm font-semibold text-primary">Community</label>
                  <p className="mt-2 inline-block rounded-full bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
                    {communityName(form.communityIds[0] ?? "")}
                  </p>
                </div>
              )}

              {modal === "add" ? (
                <div ref={stockFieldRef} className="relative">
                  <label className="text-sm font-semibold text-primary">Company Name</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="e.g. Tata Steel Ltd"
                      value={stockQuery}
                      onChange={e => changeStockQuery(e.target.value)}
                      onFocus={() => setStockDropdownOpen(true)}
                      onBlur={() => blurField("stockId")}
                      className={fieldCls(errors.stockId)}
                    />
                    <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle" />
                  </div>
                  {errors.stockId && <p className="mt-1 text-xs text-red-500">{errors.stockId}</p>}

                  {stockDropdownOpen && (
                    <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-divider bg-white shadow-card-hover">
                      {stockSearching ? (
                        <p className="px-4 py-3 text-sm text-muted">Searching…</p>
                      ) : stockOptions.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-muted">No matching stocks found</p>
                      ) : (
                        stockOptions.map(s => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => selectStock(s)}
                            className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-background ${
                              form.stockId === s.id ? "bg-accent/5 text-accent" : "text-primary"
                            }`}
                          >
                            <span className="font-semibold">{s.name}</span>
                            <span className="text-xs text-subtle">{s.symbol}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-sm font-semibold text-primary">Company Name</label>
                  <p className="mt-2 font-semibold text-primary">{selectedRecommendation?.name}</p>
                  <p className="text-xs text-subtle">{selectedRecommendation?.symbol}</p>
                </div>
              )}

              <div>
                <label className="text-sm font-semibold text-primary">Sector</label>
                <input type="text" disabled
                  value={modal === "add" ? (selectedStock?.sector ?? "") : (selectedRecommendation?.sector ?? "")}
                  placeholder="Select a company first"
                  className="mt-2 w-full rounded-xl border border-divider bg-divider/30 px-4 py-2.5 text-sm text-muted placeholder:text-subtle" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted">Entry Price ₹</label>
                  <input type="number" placeholder="e.g. 4000" value={form.entryPrice}
                    onChange={e => changeField("entryPrice", e.target.value)}
                    onBlur={() => blurField("entryPrice")}
                    className={fieldCls(errors.entryPrice)} />
                  {errors.entryPrice && <p className="mt-1 text-xs text-red-500">{errors.entryPrice}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted">Target Price ₹</label>
                  <input type="number" placeholder="e.g. 4000" value={form.targetPrice}
                    onChange={e => changeField("targetPrice", e.target.value)}
                    onBlur={() => blurField("targetPrice")}
                    className={fieldCls(errors.targetPrice)} />
                  {errors.targetPrice && <p className="mt-1 text-xs text-red-500">{errors.targetPrice}</p>}
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted">Stop Loss ₹</label>
                  <input type="number" placeholder="e.g. 4000" value={form.stopLossPrice}
                    onChange={e => changeField("stopLossPrice", e.target.value)}
                    onBlur={() => blurField("stopLossPrice")}
                    className={fieldCls(errors.stopLossPrice)} />
                  {errors.stopLossPrice && <p className="mt-1 text-xs text-red-500">{errors.stopLossPrice}</p>}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-primary">Risk Level</label>
                <div className="relative">
                  <select value={form.riskLevel}
                    onChange={e => changeField("riskLevel", e.target.value)}
                    onBlur={() => blurField("riskLevel")}
                    className={fieldCls(errors.riskLevel, true)}>
                    <option value="">Select risk level</option>
                    {RISK_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-subtle" />
                </div>
                {errors.riskLevel && <p className="mt-1 text-xs text-red-500">{errors.riskLevel}</p>}
              </div>

              <div>
                <label className="text-sm font-semibold text-primary">Call Label</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CALL_OPTIONS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => changeField("actionCall", c.value)}
                      className={`rounded-full border px-4 py-1.5 text-xs font-bold transition-colors ${
                        form.actionCall === c.value
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-divider text-muted hover:border-accent hover:text-accent"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-primary">Recommendation Notes</label>
                <textarea rows={3}
                  value={form.recommendationNotes}
                  onChange={e => changeField("recommendationNotes", e.target.value)}
                  placeholder="Add context for members' entry rationale, key levels to watch..."
                  className="mt-2 w-full resize-none rounded-xl border border-divider bg-white px-4 py-2.5 text-sm placeholder:text-subtle transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40" />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button onClick={close} disabled={submitting}
                className="flex-1 rounded-full border border-divider px-5 py-2.5 text-sm font-bold text-muted transition-colors hover:border-subtle hover:text-primary disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={modal === "add" ? handleAddRecommendation : handleUpdateRecommendation}
                disabled={submitting}
                className="flex-1 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? "Saving…" : modal === "add" ? "Add Stock" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
