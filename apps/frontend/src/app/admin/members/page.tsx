"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  LayoutGrid,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Select, { pillClass } from "@/components/ui/Select";
import { CountUp } from "@/components/admin/dashboard/CountUp";
import { EmptyState, Skeleton, stagger, TH } from "@/components/admin/dashboard/Panel";
import { TintAvatar } from "@/components/admin/dashboard/TintAvatar";
import AddMemberModal from "@/components/admin/members/AddMemberModal";
import EditMemberModal from "@/components/admin/members/EditMemberModal";
import ExtendModal from "@/components/admin/members/ExtendModal";
import SuspendModal from "@/components/admin/members/SuspendModal";
import { communityOptions, type MemberCommunity } from "@/components/admin/members/communities";
import { StatusPill } from "@/components/admin/members/memberUi";
import {
  type MemberSubscription,
  type MemberItem,
  SOURCE_LABELS,
  formatCurrency,
  formatDate,
  communityBadge,
} from "@/lib/memberFormat";

const PAGE_SIZE = 8;

interface MemberList {
  members: MemberItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface MembersResult {
  query: string;
  members: MemberItem[];
  total: number;
  totalPages: number;
}

function getPaginationPages(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, null, total];
  if (current >= total - 3) return [1, null, total - 4, total - 3, total - 2, total - 1, total];
  return [1, null, current - 1, current, current + 1, null, total];
}

type ModalState =
  | { type: "add" }
  | { type: "edit"; member: MemberItem }
  | { type: "extend"; member: MemberItem; subscription: MemberSubscription }
  | { type: "suspend"; member: MemberItem }
  | null;

/** A member's row for one subscription (a member with several communities gets several rows). */
interface Row {
  m: MemberItem;
  sub: MemberSubscription | null;
  /** 1-based position of the member on this page; only the member's first row shows it. */
  n: number;
  first: boolean;
}

function toRows(members: MemberItem[]): Row[] {
  return members.flatMap((m, mi): Row[] =>
    m.allSubscriptions.length > 0
      ? m.allSubscriptions.map((sub, si) => ({ m, sub, n: mi + 1, first: si === 0 }))
      : [{ m, sub: null, n: mi + 1, first: true }],
  );
}

/** Whole days from today (local) to a YYYY-MM-DD date; negative once it has passed. */
function daysUntil(date: string, now: number): number {
  const today = new Date(now);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.parse(date) - todayUtc) / 86_400_000);
}

function ValidTill({ sub, now }: { sub: MemberSubscription | null; now: number }) {
  if (!sub) return <span className="text-muted">—</span>;
  const days = daysUntil(sub.validUntil, now);
  if (days < 0) return <span className="font-medium text-red-500">{formatDate(sub.validUntil)}</span>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-muted">
      {formatDate(sub.validUntil)}
      {sub.isActive && days <= 7 && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
          {days === 0 ? "Today" : `${days}d left`}
        </span>
      )}
    </span>
  );
}

function StatTile({
  icon,
  iconClass,
  value,
  label,
  active,
  onClick,
  delay,
}: {
  icon: ReactNode;
  iconClass: string;
  value: number;
  label: string;
  active: boolean;
  onClick: () => void;
  delay: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ animationDelay: `${delay}ms` }}
      className={`animate-enter group flex items-center gap-4 rounded-2xl bg-white p-5 text-left shadow-card ring-1 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover ${
        active ? "ring-accent/40" : "ring-primary/[0.04]"
      }`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105 ${iconClass}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-display text-[28px] font-bold leading-none tracking-tight text-primary">
          <CountUp value={value} />
        </span>
        <span className="mt-1.5 block text-sm font-medium text-muted">{label}</span>
      </span>
    </button>
  );
}

function DatePill({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className={pillClass(!!value)}>
      <span className="text-xs font-bold">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="bg-transparent text-sm font-semibold text-primary focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`Clear ${label}`}
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-white hover:text-primary"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

const iconBtn =
  "flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export default function MembersPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const tableRef = useRef<HTMLDivElement>(null);
  // Captured once so render stays pure; "5d left" doesn't need to tick.
  const [now] = useState(() => Date.now());

  const [modal, setModal] = useState<ModalState>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [busy, setBusy] = useState(false); // revoke / deactivate / remove-from-community in flight
  const [exporting, setExporting] = useState(false);

  const [communities, setCommunities] = useState<MemberCommunity[]>([]);
  const [reloadTick, setReloadTick] = useState(0);
  const refresh = () => setReloadTick((t) => t + 1);

  // Stats (independent of filters)
  const [stats, setStats] = useState({ total: 0, registered: 0, pending: 0 });

  // Filters
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterCommunity, setFilterCommunity] = useState("");
  const [filterAccountStatus, setFilterAccountStatus] = useState("");
  const [filterRegistrationStatus, setFilterRegistrationStatus] = useState("");
  const [filterHasActiveSubscription, setFilterHasActiveSubscription] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [validDate, setValidDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [expiringSoon, setExpiringSoon] = useState(false);

  useEffect(() => {
    api.get<MemberCommunity[]>("/api/v1/admin/communities")
      .then(setCommunities)
      .catch(() => {});
  }, []);

  // Debounce search; a new search starts again from page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // A filter change goes back to page 1 in the same update, so it fetches once (not the old page, then page 1).
  function setFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filterCommunity) params.set("communityId", filterCommunity);
    if (filterAccountStatus) params.set("accountStatus", filterAccountStatus);
    if (filterRegistrationStatus) params.set("registrationStatus", filterRegistrationStatus);
    if (filterHasActiveSubscription) params.set("hasActiveSubscription", filterHasActiveSubscription);
    if (filterSource) params.set("source", filterSource);
    if (validDate) params.set("validTo", validDate);
    if (paidDate) { params.set("paidFrom", paidDate); params.set("paidTo", paidDate); }
    if (expiringSoon) params.set("expiringIn7Days", "true");
    return params.toString();
  }, [debouncedSearch, filterCommunity, filterAccountStatus, filterRegistrationStatus, filterHasActiveSubscription, filterSource, validDate, paidDate, expiringSoon]);

  const query = `${filterParams}${filterParams ? "&" : ""}page=${page}&pageSize=${PAGE_SIZE}`;

  // The last response remembers which query it answered: while a new one is in flight the current
  // rows stay up (dimmed) instead of the table blanking to a spinner on every filter or page change.
  const [result, setResult] = useState<MembersResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<MemberList>(`/api/v1/admin/members?${query}`)
      .then((data) => {
        if (cancelled) return;
        setResult({ query, members: data.members, total: data.total, totalPages: data.totalPages });
        setSelectedIds(new Set());
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof ApiError ? err.message : "Failed to load members");
        setResult((r) => ({ query, members: r?.members ?? [], total: r?.total ?? 0, totalPages: r?.totalPages ?? 1 }));
      });
    return () => { cancelled = true; };
  }, [query, reloadTick, toast]);

  // Summary stats (unfiltered)
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<MemberList>("/api/v1/admin/members?page=1&pageSize=1"),
      api.get<MemberList>("/api/v1/admin/members?page=1&pageSize=1&hasActiveSubscription=true"),
      api.get<MemberList>("/api/v1/admin/members?page=1&pageSize=1&registrationStatus=pending"),
    ]).then(([all, reg, pend]) => {
      if (!cancelled) setStats({ total: all.total, registered: reg.total, pending: pend.total });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadTick]);

  const loading = result === null;
  const refreshing = result !== null && result.query !== query;
  const members = useMemo(() => result?.members ?? [], [result]);
  const total = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 1;
  const rows = useMemo(() => toRows(members), [members]);

  const hasFilters = !!(debouncedSearch || search || filterCommunity || filterAccountStatus || filterRegistrationStatus ||
    filterHasActiveSubscription || filterSource || validDate || paidDate || expiringSoon);

  function clearFilters() {
    setSearch("");
    setDebouncedSearch("");
    setFilterCommunity("");
    setFilterAccountStatus("");
    setFilterRegistrationStatus("");
    setFilterHasActiveSubscription("");
    setFilterSource("");
    setValidDate("");
    setPaidDate("");
    setExpiringSoon(false);
    setPage(1);
  }

  // The stat tiles are shortcuts into the matching filter.
  const onlyFilter = (key: "all" | "registered" | "pending"): boolean => {
    const others = !!(debouncedSearch || filterCommunity || filterAccountStatus || filterSource || validDate || paidDate || expiringSoon);
    if (others) return false;
    if (key === "registered") return filterHasActiveSubscription === "true" && !filterRegistrationStatus;
    if (key === "pending") return filterRegistrationStatus === "pending" && !filterHasActiveSubscription;
    return !filterHasActiveSubscription && !filterRegistrationStatus;
  };

  function applyTile(key: "all" | "registered" | "pending") {
    clearFilters();
    if (key === "registered") setFilterHasActiveSubscription("true");
    if (key === "pending") setFilterRegistrationStatus("pending");
  }

  function goToPage(next: number) {
    setPage(next);
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelectedOnPage = members.length > 0 && members.every((m) => selectedIds.has(m.id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelectedOnPage) members.forEach((m) => next.delete(m.id));
      else members.forEach((m) => next.add(m.id));
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    const ok = await confirm({
      title: `Deactivate ${selectedIds.size} Member${selectedIds.size === 1 ? "" : "s"}?`,
      message: "They'll be logged out and won't be able to sign in again. Their posts and comments will remain visible. This can't be undone from here.",
      confirmLabel: "Yes, Deactivate",
      variant: "destructive",
    });
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const result = await api.post<{ total: number; succeeded: number; failed: number }>(
        "/api/v1/admin/members/bulk-delete",
        { userIds: Array.from(selectedIds) },
      );
      if (result.failed > 0) {
        toast.error(`Deactivated ${result.succeeded} of ${result.total} members — ${result.failed} failed.`);
      } else {
        toast.success({ title: "Members deactivated", message: `${result.succeeded} member(s) no longer have access.` });
      }
      exitSelectMode();
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to bulk delete members");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleRevokeSuspension(m: MemberItem) {
    const ok = await confirm({
      title: "Revoke Suspension?",
      message: (
        <>
          This will restore {m.name}&rsquo;s access and let them sign in again.
          {m.suspensionReason && (
            <> Suspended for: <span className="italic">&ldquo;{m.suspensionReason}&rdquo;</span></>
          )}
        </>
      ),
      confirmLabel: "Yes, Revoke",
      variant: "positive",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.patch(`/api/v1/admin/members/${m.id}/revoke`, {});
      toast.success({ title: "Suspension revoked", message: `${m.name} can sign in again.` });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke suspension");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteMember(m: MemberItem) {
    const ok = await confirm({
      title: "Deactivate Member?",
      message: `This will revoke ${m.name}'s access — they'll be logged out and won't be able to sign in again. Their posts and comments will remain visible. This can't be undone from here.`,
      confirmLabel: "Yes, Deactivate",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/api/v1/admin/members/${m.id}`);
      toast.success({ title: "Member deactivated", message: `${m.name} no longer has access to the platform.` });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to deactivate member");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevokeCommunity(m: MemberItem, communityId: string, communityName: string) {
    const ok = await confirm({
      title: "Remove from Community?",
      message: (
        <>
          This will remove <span className="font-semibold text-primary">{m.name}</span> from{" "}
          <span className="font-semibold text-primary">{communityName}</span>.
          {m.allSubscriptions.length <= 1
            ? " Since this is their only community, their account will also be deactivated."
            : ""}
        </>
      ),
      confirmLabel: "Yes, Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.delete(`/api/v1/admin/members/${m.id}/communities/${communityId}`);
      toast.success({ title: "Access revoked", message: `${m.name} removed from ${communityName}.` });
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke access");
    } finally {
      setBusy(false);
    }
  }

  async function exportMembersCSV() {
    setExporting(true);
    try {
      const blob = await api.getBlob(`/api/v1/admin/members/export?${filterParams}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `members-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to export members");
    } finally {
      setExporting(false);
    }
  }

  const pages = getPaginationPages(page, totalPages);

  const allOption = (label: string) => ({ value: "", label });
  const communityFilterOptions = [
    { value: "", label: "All communities", icon: <LayoutGrid size={13} className="text-accent" /> },
    ...communityOptions(communities),
  ];

  /** The Extend / Edit / Suspend / Remove buttons for one row, shared by the table and the mobile cards. */
  const rowActions = (m: MemberItem, sub: MemberSubscription | null) => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => sub && setModal({ type: "extend", member: { ...m, subscription: sub }, subscription: sub })}
        disabled={!sub}
        className="flex items-center gap-1 rounded-full border border-accent/60 px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <CalendarClock size={12} /> Extend
      </button>
      <button onClick={() => setModal({ type: "edit", member: m })} title="Edit member" aria-label={`Edit ${m.name}`} className={`${iconBtn} hover:bg-divider/60 hover:text-accent`}>
        <Pencil size={14} />
      </button>
      {m.accountStatus !== "deleted" &&
        (m.accountStatus === "suspended" ? (
          <button onClick={() => handleRevokeSuspension(m)} disabled={busy} title="Revoke suspension" aria-label={`Revoke suspension for ${m.name}`} className={`${iconBtn} hover:bg-emerald-50 hover:text-emerald-600`}>
            <RotateCcw size={14} />
          </button>
        ) : (
          <button onClick={() => setModal({ type: "suspend", member: m })} disabled={busy} title="Suspend member" aria-label={`Suspend ${m.name}`} className={`${iconBtn} hover:bg-amber-50 hover:text-amber-600`}>
            <Ban size={14} />
          </button>
        ))}
      <button
        onClick={() => (sub ? handleRevokeCommunity(m, sub.communityId, sub.communityName) : handleDeleteMember(m))}
        disabled={busy}
        title={sub ? `Remove from ${sub.communityName}` : "Deactivate member"}
        aria-label={sub ? `Remove ${m.name} from ${sub.communityName}` : `Deactivate ${m.name}`}
        className={`${iconBtn} hover:bg-red-50 hover:text-red-500`}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  const memberCell = (m: MemberItem, size: string) => (
    <button type="button" onClick={() => router.push(`/admin/members/${m.id}`)} className="group/m flex min-w-0 items-center gap-3 text-left">
      {m.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.avatarUrl} alt="" className={`${size} shrink-0 rounded-full object-cover ring-2 ring-white`} />
      ) : (
        <TintAvatar name={m.name} className={size} />
      )}
      <span className="min-w-0">
        <span className="block truncate font-bold text-primary transition-colors group-hover/m:text-accent">{m.name}</span>
        <span className="block text-xs tabular-nums text-muted">{m.phone}</span>
      </span>
    </button>
  );

  const communityCell = (sub: MemberSubscription | null) =>
    sub ? (
      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${communityBadge(sub.communityName)}`}>{sub.communityName}</span>
    ) : (
      <span className="text-muted">—</span>
    );

  const checkbox = (m: MemberItem) => (
    <input
      type="checkbox"
      checked={selectedIds.has(m.id)}
      onChange={() => toggleSelect(m.id)}
      className="h-4 w-4 cursor-pointer accent-accent"
      aria-label={`Select ${m.name}`}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="animate-enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Members</p>
          <h1 className="font-display text-2xl font-bold text-primary">Member Management</h1>
          <p className="mt-1 text-sm text-muted">View and manage all whitelisted members.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {selectMode ? (
            <>
              <button
                onClick={exitSelectMode}
                className="rounded-full border border-divider bg-white px-4 py-2.5 text-sm font-semibold text-muted transition-colors hover:border-subtle hover:text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0 || bulkDeleting}
                className="animate-fade flex items-center gap-2 rounded-full bg-red-500 px-4 py-2.5 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
              >
                <Trash2 size={14} />
                {bulkDeleting ? "Deleting…" : `Delete Selected${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
              </button>
            </>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-2 rounded-full border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50"
            >
              <Trash2 size={14} />
              Bulk Delete
            </button>
          )}
          <button
            onClick={() => setModal({ type: "add" })}
            className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_-10px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
          >
            <Plus size={15} className="text-lime" />
            Add Member
          </button>
        </div>
      </div>

      {/* Stats — each is a shortcut to the matching filter */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          icon={<Users size={20} />}
          iconClass="bg-gradient-to-br from-primary to-[#245a55] text-white"
          value={stats.total}
          label="Total Members"
          active={onlyFilter("all") && !hasFilters}
          onClick={() => applyTile("all")}
          delay={40}
        />
        <StatTile
          icon={<ShieldCheck size={20} />}
          iconClass="bg-gradient-to-br from-accent to-[#0b6f6f] text-white"
          value={stats.registered}
          label="Registered"
          active={onlyFilter("registered")}
          onClick={() => applyTile("registered")}
          delay={100}
        />
        <StatTile
          icon={<Clock size={20} />}
          iconClass="bg-gradient-to-br from-lime to-[#a6dc4c] text-primary"
          value={stats.pending}
          label="Pending Registration"
          active={onlyFilter("pending")}
          onClick={() => applyTile("pending")}
          delay={160}
        />
      </div>

      <section ref={tableRef} className="animate-enter scroll-mt-4 rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04]" style={{ animationDelay: "200ms" }}>
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-divider p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-full border border-divider bg-background px-4 py-2.5 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10">
              <Search size={15} className="shrink-0 text-subtle" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, email, or phone…"
                aria-label="Search members"
                className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="text-subtle transition-colors hover:text-primary">
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={exportMembersCSV}
              disabled={total === 0 || exporting}
              className="flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-all hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={14} />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Select
              value={filterCommunity}
              onChange={setFilter(setFilterCommunity)}
              ariaLabel="Community"
              options={communityFilterOptions}
              triggerClassName={`relative ${pillClass(!!filterCommunity)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            <Select
              value={filterAccountStatus}
              onChange={setFilter(setFilterAccountStatus)}
              ariaLabel="Account status"
              options={[allOption("All account status"), { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "deleted", label: "Deleted" }]}
              triggerClassName={`relative ${pillClass(!!filterAccountStatus)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            <Select
              value={filterRegistrationStatus}
              onChange={setFilter(setFilterRegistrationStatus)}
              ariaLabel="Registration"
              options={[allOption("All registration"), { value: "registered", label: "Registered" }, { value: "pending", label: "Pending sign-up" }]}
              triggerClassName={`relative ${pillClass(!!filterRegistrationStatus)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            <Select
              value={filterHasActiveSubscription}
              onChange={setFilter(setFilterHasActiveSubscription)}
              ariaLabel="Subscription"
              options={[allOption("Any subscription"), { value: "true", label: "Active subscription" }, { value: "false", label: "Expired" }]}
              triggerClassName={`relative ${pillClass(!!filterHasActiveSubscription)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            <Select
              value={filterSource}
              onChange={setFilter(setFilterSource)}
              ariaLabel="Source"
              options={[allOption("All sources"), { value: "admin", label: SOURCE_LABELS.admin }, { value: "self", label: SOURCE_LABELS.self }]}
              triggerClassName={`relative ${pillClass(!!filterSource)} focus:outline-none focus-visible:ring-4 focus-visible:ring-accent/15`}
            />
            <DatePill label="Valid till" value={validDate} onChange={setFilter(setValidDate)} />
            <DatePill label="Paid on" value={paidDate} onChange={setFilter(setPaidDate)} />
            <button
              type="button"
              aria-pressed={expiringSoon}
              onClick={() => { setExpiringSoon((v) => !v); setPage(1); }}
              className={pillClass(expiringSoon)}
            >
              <Clock size={14} />
              Expiring in 7 days
            </button>
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="animate-fade shrink-0 rounded-full px-3 py-2.5 text-sm font-semibold text-accent transition-colors hover:text-primary"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="space-y-3 p-5" aria-label="Loading members">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={hasFilters ? <SearchX size={20} /> : <UserPlus size={20} />}>
            {hasFilters ? "No members match these filters. Try adjusting or clearing them." : "No members yet. Add your first member to get started."}
          </EmptyState>
        ) : (
          <div aria-busy={refreshing} className={`transition-opacity duration-300 ${refreshing ? "pointer-events-none opacity-50" : "opacity-100"}`}>
            {/* Mobile cards */}
            <div className="flex flex-col gap-3 p-4 lg:hidden">
              {rows.map(({ m, sub }, i) => (
                <div
                  key={`${m.id}-${sub?.id ?? "none"}`}
                  style={stagger(Math.min(i, 6), 0, 50)}
                  className={`animate-enter rounded-xl border p-4 transition-all hover:shadow-card ${selectedIds.has(m.id) ? "border-accent/50 bg-accent/5" : "border-divider"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {selectMode && checkbox(m)}
                      {memberCell(m, "h-10 w-10")}
                    </div>
                    <StatusPill member={m} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-subtle">Payment</p><p className="font-bold text-primary">{sub ? formatCurrency(sub.payment) : "—"}</p></div>
                    <div><p className="text-xs text-subtle">Valid Till</p><p className="font-semibold text-primary"><ValidTill sub={sub} now={now} /></p></div>
                    <div><p className="text-xs text-subtle">Community</p>{communityCell(sub)}</div>
                    <div><p className="text-xs text-subtle">Added</p><p className="text-primary">{formatDate(m.createdAt)}</p></div>
                  </div>
                  <div className="mt-3 border-t border-divider pt-3">{rowActions(m, sub)}</div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto px-2 pb-1 pt-2 lg:block">
              <table className="w-full min-w-225 text-left text-sm">
                <thead>
                  <tr className="bg-background">
                    {selectMode && (
                      <th scope="col" className={`${TH} w-10 rounded-l-xl`}>
                        <input
                          type="checkbox"
                          checked={allSelectedOnPage}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 cursor-pointer accent-accent"
                          aria-label="Select all on this page"
                        />
                      </th>
                    )}
                    <th scope="col" className={`${TH} w-10 ${selectMode ? "" : "rounded-l-xl"}`}>#</th>
                    <th scope="col" className={TH}>Member</th>
                    <th scope="col" className={TH}>Email</th>
                    <th scope="col" className={TH}>Community</th>
                    <th scope="col" className={TH}>Payment</th>
                    <th scope="col" className={TH}>Paid On</th>
                    <th scope="col" className={TH}>Valid Till</th>
                    <th scope="col" className={TH}>Added</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={`${TH} rounded-r-xl`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ m, sub, n, first }, i) => (
                    <tr
                      key={`${m.id}-${sub?.id ?? "none"}`}
                      style={stagger(Math.min(i, 8), 0, 40)}
                      className={`animate-fade border-b border-divider/70 transition-colors last:border-0 ${selectedIds.has(m.id) ? "bg-accent/5" : "hover:bg-background/60"}`}
                    >
                      {selectMode && <td className="px-3 py-3">{first ? checkbox(m) : null}</td>}
                      <td className="px-3 py-3 text-xs tabular-nums text-subtle">{first ? (page - 1) * PAGE_SIZE + n : ""}</td>
                      <td className="px-3 py-3">
                        {first ? memberCell(m, "h-9 w-9") : <span className="ml-4 text-xs text-subtle">↳ also in</span>}
                      </td>
                      <td className="max-w-[14rem] truncate px-3 py-3 text-muted">{first ? m.email || "—" : ""}</td>
                      <td className="px-3 py-3">{communityCell(sub)}</td>
                      <td className="px-3 py-3 font-bold tabular-nums text-primary">{sub ? formatCurrency(sub.payment) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDate(sub?.paidOn)}</td>
                      <td className="px-3 py-3"><ValidTill sub={sub} now={now} /></td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">{first ? formatDate(m.createdAt) : ""}</td>
                      <td className="px-3 py-3">{first ? <StatusPill member={m} /> : null}</td>
                      <td className="px-3 py-3">{rowActions(m, sub)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pagination */}
        {!loading && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-divider px-5 py-4">
            <p className="text-sm text-muted">
              Showing <span className="font-semibold tabular-nums text-primary">{members.length}</span> of{" "}
              <span className="font-semibold tabular-nums text-primary">{total.toLocaleString("en-IN")}</span> members
            </p>
            {totalPages > 1 && (
              <nav aria-label="Pages" className="flex items-center gap-1.5">
                <button
                  onClick={() => goToPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="flex items-center gap-1 rounded-full border border-divider px-3.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={15} /> Previous
                </button>
                {pages.map((n, idx) =>
                  n === null ? (
                    <span key={`e-${idx}`} className="px-1 text-sm text-subtle">…</span>
                  ) : (
                    <button
                      key={n}
                      onClick={() => goToPage(n)}
                      aria-current={n === page ? "page" : undefined}
                      className={`h-8 w-8 rounded-full text-sm font-semibold tabular-nums transition-all ${n === page ? "bg-primary text-white shadow-glow" : "text-muted hover:bg-divider/60 hover:text-primary"}`}
                    >
                      {n}
                    </button>
                  ),
                )}
                <button
                  onClick={() => goToPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="flex items-center gap-1 rounded-full border border-divider px-3.5 py-1.5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ChevronRight size={15} />
                </button>
              </nav>
            )}
          </div>
        )}
      </section>

      {/* Modals — each owns its form state and submits itself */}
      {modal?.type === "add" && <AddMemberModal communities={communities} onClose={() => setModal(null)} onDone={refresh} />}
      {modal?.type === "edit" && (
        <EditMemberModal
          member={modal.member}
          communities={communities}
          onClose={() => setModal(null)}
          onUpdated={(updated) =>
            setResult((r) => (r ? { ...r, members: r.members.map((m) => (m.id === updated.id ? updated : m)) } : r))
          }
        />
      )}
      {modal?.type === "extend" && (
        <ExtendModal member={modal.member} subscription={modal.subscription} onClose={() => setModal(null)} onDone={refresh} />
      )}
      {modal?.type === "suspend" && <SuspendModal member={modal.member} onClose={() => setModal(null)} onDone={refresh} />}
    </div>
  );
}
