"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, Clock, Inbox, Search, SearchX, Star, UserCheck, X } from "lucide-react";
import { api } from "@/lib/api";
import { fetchCursorPage } from "@/lib/cursorPages";
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
import { StatusBadge } from "@/components/admin/tickets/TicketBadges";
import Pagination from "@/components/ui/Pagination";
import Select, { pillClass } from "@/components/ui/Select";
import { StatTile, TabButton, focusRing } from "@/components/admin/inbox/InboxParts";
import { EmptyState, Skeleton, stagger, TH } from "@/components/admin/dashboard/Panel";
import { UserAvatar } from "@/components/admin/UserAvatar";

type Tab = "all" | "unassigned" | "mine" | "in_progress" | "resolved";

const PAGE_SIZE = 10;

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
const GRID = "grid grid-cols-[100px_minmax(170px,1.1fr)_minmax(210px,2fr)_120px_130px_70px_100px] items-center gap-4";

export default function AdminTicketsPage() {
  // Opens on Unassigned: the same tickets the sidebar badge counts, so the number and the list agree.
  const [tab, setTab] = useState<Tab>("unassigned");
  const [category, setCategory] = useState<TicketCategory | "">("");
  const [type, setType] = useState<TicketType | "">("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  // Tickets matching the filters across every page — what the page numbers are counted from.
  const [matching, setMatching] = useState(0);
  const [stats, setStats] = useState<TicketStats | null>(null);
  // The filters and page the current `tickets` belong to — "loading" is simply "not loaded for these yet".
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
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

  // The page belongs to the filters it was picked under: change the tab, a filter or the search and it falls back
  // to page 1 by itself.
  const filterKey = buildQuery();
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const loadedFor = `${filterKey}#${page}`;
  const loading = loadedKey !== loadedFor;

  // The server pages by cursor; the cursors met so far let a click on a page number go straight there.
  const cursorCache = useRef<{ key: string; cursors: string[] }>({ key: filterKey, cursors: [] });

  // One page plus the counters. `fresh` ignores the remembered cursors and walks from page 1, which a live refresh
  // needs because new activity moves tickets between pages. Pure fetch — state is applied by `load`.
  const fetchTickets = useCallback(
    async (wanted: number, fresh: boolean) => {
      const known = !fresh && cursorCache.current.key === buildQuery() ? cursorCache.current.cursors : [];
      const [result, s] = await Promise.all([
        fetchCursorPage((cursor) => api.get<TicketPage<AdminTicket>>(`/api/v1/admin/tickets?${buildQuery(cursor)}`), wanted, known),
        api.get<TicketStats>("/api/v1/admin/tickets/stats"),
      ]);
      return { ...result, stats: s };
    },
    [buildQuery],
  );

  const load = useCallback(
    (fresh: boolean) => {
      const seq = ++requestSeq.current;
      const key = buildQuery();
      return fetchTickets(page, fresh).then(
        (res) => {
          if (seq !== requestSeq.current) return;
          cursorCache.current = { key, cursors: res.cursors };
          setTickets(res.data.items);
          setMatching(res.data.total ?? res.data.items.length);
          setStats(res.stats);
          setNow(Date.now());
          setError(false);
          // Tickets were resolved or removed meanwhile and this page is gone: land on the last one that exists.
          if (res.page !== page) setPageState({ key, page: res.page });
          setLoadedKey(`${key}#${res.page}`);
        },
        () => {
          if (seq !== requestSeq.current) return;
          setError(true);
          setLoadedKey(`${key}#${page}`);
        },
      );
    },
    [buildQuery, fetchTickets, page],
  );

  // New filters / search / page: load it, reusing the cursors already known.
  useEffect(() => {
    load(false);
  }, [load]);

  // Live: any ticket activity refreshes the page + counters (coalesced so a burst is one reload).
  useEffect(() => {
    ticketSocketStore.connect();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load(true);
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

  const listRef = useRef<HTMLElement>(null);
  function goToPage(next: number) {
    setPageState({ key: filterKey, page: next });
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Every ticket is exactly one of: open (unassigned), in progress, resolved.
  const allTickets = stats ? stats.unassigned + stats.inProgress + stats.resolved : undefined;

  // `loading` = nothing to show yet. After the first load, a changed filter keeps the current rows on
  // screen (dimmed) until the new ones arrive, rather than swapping them for a spinner.
  const firstLoad = loading && loadedKey === null;
  const refreshing = loading && loadedKey !== null;
  const hasFilters = !!(category || type || unreadOnly || search || searchInput);

  function clearFilters() {
    setCategory("");
    setType("");
    setUnreadOnly(false);
    setSearchInput("");
    setSearch("");
  }

  const categoryOptions = [
    { value: "", label: "All categories" },
    ...Object.entries(CATEGORY_LABEL).map(([v, l]) => ({ value: v, label: l })),
  ];
  const typeOptions = [
    { value: "", label: "All types" },
    ...Object.entries(TYPE_LABEL).map(([v, l]) => ({ value: v, label: l })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter">
        <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Tickets</p>
        <h1 className="font-display text-2xl font-bold text-primary">Support Tickets</h1>
        <p className="mt-1 text-sm text-muted">
          View and resolve tickets raised by members from the mobile app
          {allTickets !== undefined && (
            <>
              {" · "}
              <span className="font-semibold tabular-nums text-primary">{allTickets.toLocaleString("en-IN")}</span> in total
            </>
          )}
          .
        </p>
      </div>

      {/* Counters — each is a shortcut to the matching tab */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<Inbox size={20} />}
          iconClass="bg-gradient-to-br from-rose-500 to-red-600 text-white"
          label="Unassigned"
          value={stats?.unassigned}
          caption="Awaiting first response"
          captionClass="text-rose-600"
          active={tab === "unassigned"}
          onClick={() => setTab("unassigned")}
          delay={40}
        />
        <StatTile
          icon={<UserCheck size={20} />}
          iconClass="bg-gradient-to-br from-amber-400 to-orange-500 text-white"
          label="My open tickets"
          value={stats?.mine}
          caption={stats?.mineUnread ? `${stats.mineUnread} with new messages` : "Assigned to you"}
          captionClass="text-amber-700"
          active={tab === "mine"}
          onClick={() => setTab("mine")}
          delay={100}
        />
        <StatTile
          icon={<Clock size={20} />}
          iconClass="bg-gradient-to-br from-accent to-[#0b6f6f] text-white"
          label="In progress"
          value={stats?.inProgress}
          caption="Being handled by support"
          captionClass="text-accent"
          active={tab === "in_progress"}
          onClick={() => setTab("in_progress")}
          delay={160}
        />
        <StatTile
          icon={<CheckCircle2 size={20} />}
          iconClass="bg-gradient-to-br from-lime to-[#a6dc4c] text-primary"
          label="Resolved"
          value={stats?.resolved}
          caption={
            stats?.averageRating != null
              ? `★ ${stats.averageRating} avg · ${stats.ratingCount} rating${stats.ratingCount === 1 ? "" : "s"}`
              : "No ratings yet"
          }
          captionClass="text-emerald-700"
          active={tab === "resolved"}
          onClick={() => setTab("resolved")}
          delay={220}
        />
      </div>

      <section ref={listRef} className="animate-enter scroll-mt-4 rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04]" style={{ animationDelay: "260ms" }}>
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-divider p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-full border border-divider bg-background px-4 py-2.5 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10">
              <Search size={15} className="shrink-0 text-subtle" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by ticket ID or member…"
                aria-label="Search tickets"
                className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
              />
              {searchInput && (
                <button type="button" onClick={() => { setSearchInput(""); setSearch(""); }} aria-label="Clear search" className="text-subtle transition-colors hover:text-primary">
                  <X size={14} />
                </button>
              )}
            </div>
            <Select
              value={category}
              onChange={(v) => setCategory(v as TicketCategory | "")}
              ariaLabel="Category"
              options={categoryOptions}
              triggerClassName={`relative ${pillClass(!!category)} ${focusRing}`}
            />
            <Select
              value={type}
              onChange={(v) => setType(v as TicketType | "")}
              ariaLabel="Type"
              options={typeOptions}
              triggerClassName={`relative ${pillClass(!!type)} ${focusRing}`}
            />
            <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} className={`${pillClass(unreadOnly)} ${focusRing}`}>
              <Bell size={14} />
              Unread only
            </button>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="animate-fade shrink-0 rounded-full px-3 py-2.5 text-sm font-semibold text-accent transition-colors hover:text-primary">
                Clear filters
              </button>
            )}
          </div>

          <div role="group" aria-label="Show tickets" className="flex w-fit max-w-full flex-wrap rounded-full bg-background p-1">
            <TabButton active={tab === "all"} label="All" count={allTickets} onClick={() => setTab("all")} />
            <TabButton active={tab === "unassigned"} label="Unassigned" count={stats?.unassigned} onClick={() => setTab("unassigned")} />
            <TabButton active={tab === "mine"} label="Mine" count={stats?.mine} onClick={() => setTab("mine")} />
            <TabButton active={tab === "in_progress"} label="In progress" count={stats?.inProgress} onClick={() => setTab("in_progress")} />
            <TabButton active={tab === "resolved"} label="Resolved" count={stats?.resolved} onClick={() => setTab("resolved")} />
          </div>
        </div>

        {/* List */}
        {firstLoad ? (
          <div className="space-y-3 p-5" aria-label="Loading tickets">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : error ? (
          <EmptyState icon={<SearchX size={20} />}>
            <span className="flex flex-col items-center gap-3">
              Couldn&apos;t load tickets.
              <button
                onClick={() => { setLoadedKey(null); load(true); }}
                className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
              >
                Retry
              </button>
            </span>
          </EmptyState>
        ) : tickets.length === 0 && !refreshing ? (
          <EmptyState icon={hasFilters || (tab !== "all" && tab !== "unassigned") ? <SearchX size={20} /> : <Inbox size={20} />}>
            <span className="flex flex-col items-center gap-3">
              {hasFilters || (tab !== "all" && tab !== "unassigned")
                ? "No tickets match these filters."
                : tab === "unassigned"
                  ? "No unassigned tickets. Every open ticket has been picked up."
                  : "No tickets yet. They'll appear here when members raise an issue from the app."}
              {hasFilters && (
                <button onClick={clearFilters} className="rounded-full border border-divider px-5 py-2 text-sm font-semibold text-primary transition-colors hover:border-accent">
                  Clear filters
                </button>
              )}
            </span>
          </EmptyState>
        ) : (
          <div aria-busy={refreshing} className={`overflow-x-auto px-2 pb-2 pt-2 transition-opacity duration-300 ${refreshing ? "pointer-events-none opacity-50" : "opacity-100"}`}>
            <div className="min-w-215">
              <div className={`${GRID} rounded-xl bg-background px-4 py-2.5`} role="row">
                {["Ticket", "Member", "Subject", "Category", "Status", "Rating", "Last update"].map((h) => (
                  <span key={h} className={`${TH} !p-0`} role="columnheader">{h}</span>
                ))}
              </div>

              {tickets.map((t, i) => {
                const unread = t.unreadCount > 0;
                return (
                  <Link
                    key={t.id}
                    href={`/admin/tickets/${t.id}`}
                    style={stagger(Math.min(i, 8), 0, 35)}
                    title={`${t.subject} · ${t.communityName}${t.assignedAdmin ? ` · Assigned to ${t.assignedAdmin.name}` : " · Unassigned"}`}
                    className={`${GRID} animate-fade group relative border-b border-divider/70 px-4 py-3.5 text-sm text-primary transition-colors last:border-b-0 hover:bg-background/60 ${focusRing} ${
                      unread ? "bg-accent/[0.04]" : ""
                    }`}
                  >
                    {/* Unread: a teal edge on the row, plus the count for screen readers. */}
                    {unread && <span aria-hidden className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-accent" />}
                    <span className="flex items-center gap-2 font-bold tabular-nums transition-colors group-hover:text-accent">
                      #{t.label}
                      {unread && (
                        <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white" aria-label={`${t.unreadCount} unread`}>
                          {t.unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 items-center gap-3">
                      <UserAvatar name={t.user.name} avatarUrl={t.user.avatarUrl} className="h-9 w-9" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{t.user.name}</span>
                        <span className={`block truncate text-[11px] ${t.assignedAdmin ? "text-muted" : "font-semibold text-rose-500"}`}>
                          {t.assignedAdmin ? `Assigned to ${t.assignedAdmin.name}` : "Unassigned"}
                        </span>
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate ${unread ? "font-bold" : "font-medium"}`}>{t.subject}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {TYPE_LABEL[t.type]} · {t.communityName}
                      </span>
                    </span>
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
                    <span className="whitespace-nowrap text-xs text-muted">{timeAgo(t.lastMessageAt, now)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        {!firstLoad && !error && tickets.length > 0 && (
          <Pagination
            className="px-5 pb-4"
            page={page}
            pageSize={PAGE_SIZE}
            total={matching}
            noun={matching === 1 ? "ticket" : "tickets"}
            onPage={goToPage}
          />
        )}
      </section>
    </div>
  );
}
