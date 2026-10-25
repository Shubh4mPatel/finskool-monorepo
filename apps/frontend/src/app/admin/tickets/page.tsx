"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Inbox, Loader2, Search, Star } from "lucide-react";
import { api } from "@/lib/api";
import {
  CATEGORY_LABEL,
  TYPE_LABEL,
  timeAgo,
  type AdminTicket,
  type TicketCategory,
  type TicketPage,
  type TicketStats,
  type TicketType,
} from "@/lib/tickets";
import { ticketSocketStore } from "@/store/tickets/ticketSocketStore";
import { Avatar, StatusBadge } from "@/components/admin/tickets/TicketBadges";

type Tab = "all" | "unassigned" | "mine" | "in_progress" | "resolved";

const PAGE_SIZE = 20;

// "Unassigned" / "Mine" are open-ticket counts in /stats, so those tabs list open tickets only.
function tabParams(tab: Tab): Record<string, string> {
  switch (tab) {
    case "unassigned":
      return { assignee: "unassigned", open: "true" };
    case "mine":
      return { assignee: "me", open: "true" };
    case "in_progress":
      return { status: "in_progress" };
    case "resolved":
      return { status: "resolved" };
    default:
      return {};
  }
}

// One grid shared by the header row and every ticket row so the columns line up.
const GRID = "grid grid-cols-[110px_minmax(160px,1.1fr)_minmax(200px,2fr)_120px_130px_70px_110px] items-center gap-4";

function FilterSelect({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-11 cursor-pointer appearance-none rounded-full border border-[#dcd9d0] bg-white pl-5 pr-10 text-sm font-medium text-primary outline-none transition-colors hover:border-accent focus:border-accent"
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

function Pill({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${
        active ? "border-primary bg-primary text-white" : "border-[#dcd9d0] bg-white text-primary hover:border-accent"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? "bg-lime text-primary" : "bg-background text-primary"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function StatCard({ label, value, caption, captionClass }: { label: string; value: React.ReactNode; caption: string; captionClass: string }) {
  return (
    <div className="rounded-3xl bg-white px-6 py-5 shadow-card">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold text-primary">{value}</p>
      <p className={`mt-1 text-xs font-semibold ${captionClass}`}>{caption}</p>
    </div>
  );
}

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
  // Drives the relative "15 min ago" labels; ticks so they don't go stale while the page stays open.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), ...tabParams(tab) });
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
  // Pages the admin has pulled in with "Load more". A live refresh re-fetches that many pages, so
  // it updates rows in place instead of collapsing the list back to the first page.
  const pagesLoaded = useRef(1);

  const queryKey = buildQuery();
  const loading = loadedKey !== queryKey;

  // The first `pages` pages plus the counters. Pure fetch — state is applied by `load`.
  const fetchTickets = useCallback(
    async (pages: number) => {
      const [first, s] = await Promise.all([
        api.get<TicketPage<AdminTicket>>(`/api/v1/admin/tickets?${buildQuery()}`),
        api.get<TicketStats>("/api/v1/admin/tickets/stats"),
      ]);
      let items = first.items;
      let nextCursor = first.nextCursor;
      for (let i = 1; i < pages && nextCursor; i++) {
        const page = await api.get<TicketPage<AdminTicket>>(`/api/v1/admin/tickets?${buildQuery(nextCursor)}`);
        const seen = new Set(items.map((t) => t.id));
        items = [...items, ...page.items.filter((t) => !seen.has(t.id))];
        nextCursor = page.nextCursor;
      }
      return { items, nextCursor, stats: s };
    },
    [buildQuery],
  );

  const load = useCallback(
    (pages: number) => {
      const seq = ++requestSeq.current;
      const key = buildQuery();
      return fetchTickets(pages).then(
        (res) => {
          if (seq !== requestSeq.current) return;
          setTickets(res.items);
          setNextCursor(res.nextCursor);
          setStats(res.stats);
          setNow(Date.now());
          setError(false);
          setLoadedKey(key);
          window.dispatchEvent(new Event("admin-tickets:updated"));
        },
        () => {
          if (seq !== requestSeq.current) return;
          setError(true);
          setLoadedKey(key);
        },
      );
    },
    [buildQuery, fetchTickets],
  );

  // New filters / search start again from the first page.
  useEffect(() => {
    pagesLoaded.current = 1;
    load(1);
  }, [load]);

  // Live: any ticket activity refreshes the list + counters (coalesced so a burst is one reload).
  useEffect(() => {
    ticketSocketStore.connect();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load(pagesLoaded.current);
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
      pagesLoaded.current += 1;
    } catch {
      // keep the current list; the button stays so the admin can retry
    } finally {
      setLoadingMore(false);
    }
  }

  // Every ticket is exactly one of: open (unassigned), in progress, resolved.
  const total = stats ? stats.unassigned + stats.inProgress + stats.resolved : undefined;
  const dash = "–";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="flex items-center gap-1 text-xs font-semibold text-accent">
          Dashboard <ChevronRight size={12} /> Tickets <ChevronRight size={12} /> Support tickets
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-primary">Tickets</h1>
        <p className="mt-1 text-sm text-muted">View and resolve tickets raised by members.</p>
      </div>

      {/* Section switcher — Support tickets is the only section so far. */}
      <div className="flex w-fit items-center gap-1 rounded-full border border-[#dcd9d0] bg-white p-1">
        <span className="flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-white">
          Support tickets
          <span className="rounded-full bg-lime px-2 py-0.5 text-[11px] font-bold text-primary">{total ?? dash}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Unassigned"
          value={stats?.unassigned ?? dash}
          caption="Awaiting first response"
          captionClass="text-[#e11d48]"
        />
        <StatCard
          label="My open tickets"
          value={stats?.mine ?? dash}
          caption={stats?.mineUnread ? `${stats.mineUnread} with new messages` : "Assigned to you"}
          captionClass="text-[#a16207]"
        />
        <StatCard label="In progress" value={stats?.inProgress ?? dash} caption="Being handled by support" captionClass="text-[#1d4ed8]" />
        <StatCard
          label="Resolved"
          value={stats?.resolved ?? dash}
          caption={
            stats?.averageRating != null
              ? `★ ${stats.averageRating} avg · ${stats.ratingCount} rating${stats.ratingCount === 1 ? "" : "s"}`
              : "No ratings yet"
          }
          captionClass="text-[#16a34a]"
        />
      </div>

      <section className="rounded-3xl bg-white px-7 py-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-primary">Support Tickets</h2>
            <p className="mt-1 text-sm text-muted">Created when members raise an issue from the mobile app.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by ticket ID or member"
                className="h-11 w-72 rounded-full border border-[#dcd9d0] bg-white pl-11 pr-4 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
              />
            </div>
            <FilterSelect label="Category" value={category} onChange={(v) => setCategory(v as TicketCategory | "")}>
              <option value="">Category: All</option>
              {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>Category: {l}</option>
              ))}
            </FilterSelect>
            <FilterSelect label="Type" value={type} onChange={(v) => setType(v as TicketType | "")}>
              <option value="">Type: All</option>
              {Object.entries(TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>Type: {l}</option>
              ))}
            </FilterSelect>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill active={tab === "all"} label="All" count={total} onClick={() => setTab("all")} />
            <Pill active={tab === "unassigned"} label="Unassigned" count={stats?.unassigned} onClick={() => setTab("unassigned")} />
            <Pill active={tab === "mine"} label="Mine" count={stats?.mine} onClick={() => setTab("mine")} />
            <Pill active={tab === "in_progress"} label="In progress" count={stats?.inProgress} onClick={() => setTab("in_progress")} />
            <Pill active={tab === "resolved"} label="Resolved" count={stats?.resolved} onClick={() => setTab("resolved")} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="h-4 w-4 accent-primary" />
            Unread only
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          <div className="min-w-205">
            <div className={`${GRID} rounded-xl bg-background px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted`}>
              <span>Ticket</span>
              <span>Member</span>
              <span>Subject</span>
              <span>Category</span>
              <span>Status</span>
              <span>Rating</span>
              <span>Last update</span>
            </div>

            {loading ? (
              <div className="flex justify-center py-16 text-muted"><Loader2 className="animate-spin" /></div>
            ) : error ? (
              <div className="py-16 text-center">
                <p className="text-sm font-semibold text-primary">Couldn&apos;t load tickets</p>
                <button
                  onClick={() => { setLoadedKey(null); pagesLoaded.current = 1; load(1); }}
                  className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white"
                >
                  Retry
                </button>
              </div>
            ) : tickets.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <Inbox size={28} className="text-subtle" />
                <p className="text-sm font-semibold text-primary">No tickets here</p>
                <p className="text-xs text-muted">Nothing matches the current filters.</p>
              </div>
            ) : (
              tickets.map((t) => (
                <Link
                  key={t.id}
                  href={`/admin/tickets/${t.id}`}
                  title={`${t.subject} · ${t.communityName}${t.assignedAdmin ? ` · Assigned to ${t.assignedAdmin.name}` : " · Unassigned"}`}
                  className={`${GRID} border-b border-divider px-4 py-3 text-sm text-primary transition-colors last:border-b-0 hover:bg-background/70`}
                >
                  <span className="flex items-center gap-2 font-bold">
                    #{t.label}
                    {t.unreadCount > 0 && (
                      <span className="h-2 w-2 rounded-full bg-accent" aria-label={`${t.unreadCount} unread`} />
                    )}
                  </span>
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={t.user.name} />
                    <span className="truncate font-medium">{t.user.name}</span>
                  </span>
                  <span className={`truncate ${t.unreadCount > 0 ? "font-semibold" : ""}`}>{t.subject}</span>
                  <span className="truncate text-primary/80">{CATEGORY_LABEL[t.category]}</span>
                  <span><StatusBadge status={t.status} /></span>
                  <span className="text-sm font-semibold">
                    {t.rating !== null ? (
                      <span className="flex items-center gap-1 text-primary">
                        <Star size={13} className="text-amber-500" fill="currentColor" /> {t.rating}
                      </span>
                    ) : (
                      <span className="font-normal text-subtle">—</span>
                    )}
                  </span>
                  <span className="text-muted">{timeAgo(t.lastMessageAt, now)}</span>
                </Link>
              ))
            )}
          </div>
        </div>

        {!loading && !error && nextCursor && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="mx-auto mt-4 flex items-center gap-2 rounded-full border border-[#dcd9d0] bg-white px-6 py-2.5 text-sm font-semibold text-primary transition-colors hover:border-accent disabled:opacity-50"
          >
            {loadingMore && <Loader2 size={14} className="animate-spin" />}
            Load more
          </button>
        )}
      </section>
    </div>
  );
}
