"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Inbox, Loader2, Search, Star } from "lucide-react";
import { api } from "@/lib/api";
import {
  CATEGORY_LABEL,
  TYPE_LABEL,
  formatTicketTime,
  type AdminTicket,
  type TicketCategory,
  type TicketPage,
  type TicketStats,
  type TicketType,
} from "@/lib/tickets";
import { ticketSocketStore } from "@/store/tickets/ticketSocketStore";
import { Chip, StatusBadge } from "@/components/admin/tickets/TicketBadges";

type Tab = "all" | "unassigned" | "mine" | "in_progress" | "resolved";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unassigned", label: "Unassigned" },
  { id: "mine", label: "Mine" },
  { id: "in_progress", label: "In Progress" },
  { id: "resolved", label: "Resolved" },
];

function tabParams(tab: Tab): Record<string, string> {
  switch (tab) {
    case "unassigned":
      return { assignee: "unassigned" };
    case "mine":
      return { assignee: "me" };
    case "in_progress":
      return { status: "in_progress" };
    case "resolved":
      return { status: "resolved" };
    default:
      return {};
  }
}

const selectClass =
  "rounded-full border border-divider bg-white px-4 py-2 text-sm font-semibold text-muted outline-none transition-colors hover:border-accent focus:border-accent";

export default function AdminTicketsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [category, setCategory] = useState<TicketCategory | "">("");
  const [type, setType] = useState<TicketType | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<TicketStats | null>(null);
  // The query the current `tickets` belong to — "loading" is simply "not loaded for the current filters yet".
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: "20", ...tabParams(tab) });
      if (category) params.set("category", category);
      if (type) params.set("type", type);
      if (unreadOnly) params.set("unread", "true");
      if (search) params.set("search", search);
      if (cursor) params.set("cursor", cursor);
      return params.toString();
    },
    [tab, category, type, unreadOnly, search],
  );

  // Guards against an older, slower response overwriting a newer one (fast tab switching).
  const requestSeq = useRef(0);

  const queryKey = buildQuery();
  const loading = loadedKey !== queryKey;

  const load = useCallback(
    async () => {
      const seq = ++requestSeq.current;
      const key = buildQuery();
      try {
        const [page, s] = await Promise.all([
          api.get<TicketPage<AdminTicket>>(`/api/v1/admin/tickets?${buildQuery()}`),
          api.get<TicketStats>("/api/v1/admin/tickets/stats"),
        ]);
        if (seq !== requestSeq.current) return;
        setTickets(page.items);
        setNextCursor(page.nextCursor);
        setStats(s);
        setError(false);
        setLoadedKey(key);
        window.dispatchEvent(new Event("admin-tickets:updated"));
      } catch {
        if (seq === requestSeq.current) {
          setError(true);
          setLoadedKey(key);
        }
      }
    },
    [buildQuery],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Live: any ticket activity refreshes the list + counters (coalesced so a burst is one reload).
  useEffect(() => {
    ticketSocketStore.connect();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, 400);
    };
    const offEvents = ticketSocketStore.subscribe(refresh);
    const offReconnect = ticketSocketStore.onReconnect(refresh);
    return () => {
      offEvents();
      offReconnect();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.get<TicketPage<AdminTicket>>(`/api/v1/admin/tickets?${buildQuery(nextCursor)}`);
      setTickets((prev) => [...prev, ...page.items.filter((t) => !prev.some((p) => p.id === t.id))]);
      setNextCursor(page.nextCursor);
    } catch {
      // keep the current list; the button stays so the admin can retry
    } finally {
      setLoadingMore(false);
    }
  }

  const statCards = [
    { label: "Unassigned", value: stats?.unassigned, accent: (stats?.unassigned ?? 0) > 0 },
    { label: "My Open", value: stats?.mine, sub: stats?.mineUnread ? `${stats.mineUnread} unread` : undefined },
    { label: "In Progress", value: stats?.inProgress },
    { label: "Resolved", value: stats?.resolved },
    {
      label: "Avg. Rating",
      value: stats?.averageRating ?? "–",
      sub: stats?.ratingCount ? `${stats.ratingCount} rating${stats.ratingCount === 1 ? "" : "s"}` : undefined,
    },
  ];

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Support Tickets</p>
        <h1 className="font-display text-2xl font-bold text-primary">Support Tickets</h1>
        <p className="mt-1 text-sm text-muted">Issues raised by members from the mobile app. Take a ticket to reply and resolve it.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statCards.map((c) => (
          <div key={c.label} className="rounded-2xl bg-white px-4 py-3 shadow-card">
            <p className="text-[11px] font-semibold text-muted">{c.label}</p>
            <p className={`font-display text-xl font-bold ${c.accent ? "text-red-500" : "text-primary"}`}>{c.value ?? "–"}</p>
            {c.sub && <p className="text-[11px] font-semibold text-accent">{c.sub}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.id ? "bg-primary text-white" : "bg-white text-muted shadow-card hover:bg-divider/60 hover:text-primary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search subject, member or FS-number"
            className="w-full rounded-full border border-divider bg-white py-2 pl-10 pr-4 text-sm text-primary outline-none transition-colors placeholder:text-subtle focus:border-accent"
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory | "")} className={selectClass}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as TicketType | "")} className={selectClass}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-muted">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="accent-primary" />
          Unread only
        </label>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-muted"><Loader2 className="animate-spin" /></div>
      ) : error ? (
        <div className="rounded-2xl bg-white py-16 text-center shadow-card">
          <p className="text-sm font-semibold text-primary">Couldn&apos;t load tickets</p>
          <button onClick={() => { setLoadedKey(null); load(); }} className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Retry</button>
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-white py-16 text-center shadow-card">
          <Inbox size={28} className="text-subtle" />
          <p className="text-sm font-semibold text-primary">No tickets here</p>
          <p className="text-xs text-muted">Nothing matches the current filters.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tickets.map((t) => (
            <Link
              key={t.id}
              href={`/admin/tickets/${t.id}`}
              className="flex flex-col gap-2 rounded-2xl bg-white px-5 py-4 shadow-card transition-shadow hover:shadow-card-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-accent">{t.label}</p>
                  <p className={`truncate text-sm text-primary ${t.unreadCount > 0 ? "font-bold" : "font-semibold"}`}>{t.subject}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {t.unreadCount > 0 && (
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">{t.unreadCount} new</span>
                  )}
                  <StatusBadge status={t.status} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Chip>{CATEGORY_LABEL[t.category]}</Chip>
                <Chip>{TYPE_LABEL[t.type]}</Chip>
                <Chip>{t.communityName}</Chip>
                {t.rating !== null && (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-amber-600">
                    <Star size={12} fill="currentColor" /> {t.rating}/5
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>
                  {t.user.name} · {t.user.phone}
                </span>
                <span>
                  {t.assignedAdmin ? `Assigned to ${t.assignedAdmin.name}` : "Unassigned"} · {formatTicketTime(t.lastMessageAt)}
                </span>
              </div>
            </Link>
          ))}
          {nextCursor && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-auto flex items-center gap-2 rounded-full border border-divider bg-white px-5 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-50"
            >
              {loadingMore && <Loader2 size={14} className="animate-spin" />}
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
