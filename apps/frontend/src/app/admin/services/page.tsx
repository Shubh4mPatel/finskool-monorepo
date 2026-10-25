"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  FileText,
  Inbox,
  Loader2,
  Search,
  SearchX,
  Send,
  Settings2,
  Star,
  UserCheck,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useIsSuperAdmin } from "@/lib/session";
import { formatInr } from "@/lib/services";
import type { AdminServiceRequest, ServiceStats } from "@/lib/services";
import { timeAgo } from "@/lib/tickets";
import type { TicketPage } from "@/lib/tickets";
import { ticketSocketStore } from "@/store/tickets/ticketSocketStore";
import { pillClass } from "@/components/ui/Select";
import { EmptyState, Skeleton, stagger, TH } from "@/components/admin/dashboard/Panel";
import { TintAvatar } from "@/components/admin/dashboard/TintAvatar";
import { StatTile, TabButton, focusRing } from "@/components/admin/inbox/InboxParts";
import ServicesTabs from "@/components/admin/services/ServicesTabs";
import { RequestStatusBadge } from "@/components/admin/services/ServiceBadges";

type Tab = "all" | "unassigned" | "mine" | "requested" | "quote_sent" | "paid" | "closed" | "review";

const PAGE_SIZE = 20;

// "Unassigned" / "Mine" are open-request counts in /stats, so those tabs list open requests only.
function tabParams(tab: Tab): Record<string, string> {
  switch (tab) {
    case "unassigned":
      return { assignee: "unassigned", open: "true" };
    case "mine":
      return { assignee: "me", open: "true" };
    case "requested":
    case "quote_sent":
    case "paid":
    case "closed":
      return { status: tab };
    case "review":
      return { review: "true" };
    default:
      return {};
  }
}

// One grid shared by the header row and every request row so the columns line up.
const GRID = "grid grid-cols-[100px_minmax(170px,1fr)_minmax(200px,1.5fr)_120px_150px_70px_100px] items-center gap-4";

function AdminServicesInbox() {
  const isSuperAdmin = useIsSuperAdmin();
  // Set when arriving from a service card's "View enquiries".
  const serviceId = useSearchParams().get("serviceId");
  const [serviceTitle, setServiceTitle] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [requests, setRequests] = useState<AdminServiceRequest[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<ServiceStats | null>(null);
  // The query the current `requests` belong to — "loading" is simply "not loaded for the current filters yet".
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
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

  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    api
      .get<{ title: string }>(`/api/v1/admin/services/catalog/${serviceId}`)
      .then((svc) => {
        if (!cancelled) setServiceTitle(svc.title);
      })
      .catch(() => {
        if (!cancelled) setServiceTitle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), ...tabParams(tab) });
      if (unreadOnly) params.set("unread", "true");
      if (search) params.set("search", search);
      if (serviceId) params.set("serviceId", serviceId);
      if (cursor) params.set("cursor", cursor);
      return params.toString();
    },
    [tab, unreadOnly, search, serviceId],
  );

  // Guards against an older, slower response overwriting a newer one (fast tab switching).
  const requestSeq = useRef(0);
  // Pages pulled in with "Load more". A live refresh re-fetches that many pages, so it updates rows in
  // place instead of collapsing the list back to the first page.
  const pagesLoaded = useRef(1);

  const queryKey = buildQuery();
  const loading = loadedKey !== queryKey;

  const fetchRequests = useCallback(
    async (pages: number) => {
      const [first, s] = await Promise.all([
        api.get<TicketPage<AdminServiceRequest>>(`/api/v1/admin/services?${buildQuery()}`),
        api.get<ServiceStats>("/api/v1/admin/services/stats"),
      ]);
      let items = first.items;
      let nextCursor = first.nextCursor;
      for (let i = 1; i < pages && nextCursor; i++) {
        const page = await api.get<TicketPage<AdminServiceRequest>>(`/api/v1/admin/services?${buildQuery(nextCursor)}`);
        const seen = new Set(items.map((r) => r.id));
        items = [...items, ...page.items.filter((r) => !seen.has(r.id))];
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
      return fetchRequests(pages).then(
        (res) => {
          if (seq !== requestSeq.current) return;
          setRequests(res.items);
          setNextCursor(res.nextCursor);
          setStats(res.stats);
          setNow(Date.now());
          setError(false);
          setLoadedKey(key);
          window.dispatchEvent(new Event("admin-services:updated"));
        },
        () => {
          if (seq !== requestSeq.current) return;
          setError(true);
          setLoadedKey(key);
        },
      );
    },
    [buildQuery, fetchRequests],
  );

  // New filters / search start again from the first page.
  useEffect(() => {
    pagesLoaded.current = 1;
    load(1);
  }, [load]);

  // Live: any service activity refreshes the list + counters (coalesced so a burst is one reload).
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
    const offEvents = ticketSocketStore.subscribeServices(refresh);
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
      const page = await api.get<TicketPage<AdminServiceRequest>>(`/api/v1/admin/services?${buildQuery(nextCursor)}`);
      setRequests((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]);
      setNextCursor(page.nextCursor);
      pagesLoaded.current += 1;
    } catch {
      // keep the current list; the button stays so the admin can retry
    } finally {
      setLoadingMore(false);
    }
  }

  const total = stats ? stats.requested + stats.quoteSent + stats.paid + stats.closed : undefined;

  // `loading` = nothing to show yet. After the first load, a changed filter keeps the current rows on
  // screen (dimmed) until the new ones arrive, rather than swapping them for a spinner.
  const firstLoad = loading && loadedKey === null;
  const refreshing = loading && loadedKey !== null;
  const hasFilters = !!(unreadOnly || search || searchInput);

  function clearFilters() {
    setUnreadOnly(false);
    setSearchInput("");
    setSearch("");
  }

  const needsReview = stats?.needsReview ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-accent">Dashboard &rsaquo; Services</p>
          <h1 className="font-display text-2xl font-bold text-primary">Services</h1>
          <p className="mt-1 text-sm text-muted">
            Requests members raise for your services — agree the scope in chat, send a quote, get paid, deliver.
          </p>
        </div>
        {isSuperAdmin && (
          <Link
            href="/admin/settings/billing"
            className="inline-flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-2.5 text-sm font-semibold text-primary transition-all hover:border-accent hover:text-accent"
          >
            <Settings2 size={15} /> Billing settings
          </Link>
        )}
      </div>

      <ServicesTabs active="enquiries" />

      {serviceId && (
        <div className="animate-fade flex flex-wrap items-center gap-3 rounded-2xl bg-accent/10 px-5 py-3 text-sm text-primary">
          <span>
            Showing enquiries for <strong>{serviceTitle ?? "this service"}</strong>
          </span>
          <Link
            href="/admin/services"
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-bold text-accent shadow-sm transition-colors hover:text-primary"
          >
            <X size={12} /> Show all
          </Link>
        </div>
      )}

      {needsReview > 0 && (
        <button
          type="button"
          onClick={() => setTab("review")}
          role="alert"
          className={`animate-fade group flex items-center gap-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-left text-sm text-red-900 transition-colors hover:bg-red-100/70 ${focusRing}`}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
            <AlertTriangle size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block">
              {needsReview} payment{needsReview === 1 ? "" : "s"} need{needsReview === 1 ? "s" : ""} review.
            </strong>
            <span className="text-red-800/80">
              Money arrived that could not be applied to a request — refund it in the Razorpay dashboard, then mark it resolved.
            </span>
          </span>
          <span className="hidden shrink-0 items-center gap-1 text-xs font-bold text-red-700 sm:inline-flex">
            Review <ArrowRight size={13} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </span>
        </button>
      )}

      {/* Counters — each is a shortcut to the matching tab */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<Inbox size={20} />}
          iconClass="bg-gradient-to-br from-rose-500 to-red-600 text-white"
          label="Unassigned"
          value={stats?.unassigned}
          caption="Waiting for someone to pick up"
          captionClass="text-rose-600"
          active={tab === "unassigned"}
          onClick={() => setTab("unassigned")}
          delay={40}
        />
        <StatTile
          icon={<UserCheck size={20} />}
          iconClass="bg-gradient-to-br from-amber-400 to-orange-500 text-white"
          label="My open requests"
          value={stats?.mine}
          caption={stats?.mineUnread ? `${stats.mineUnread} with new messages` : "Assigned to you"}
          captionClass="text-amber-700"
          active={tab === "mine"}
          onClick={() => setTab("mine")}
          delay={100}
        />
        <StatTile
          icon={<Send size={20} />}
          iconClass="bg-gradient-to-br from-accent to-[#0b6f6f] text-white"
          label="Quote sent"
          value={stats?.quoteSent}
          caption="Waiting for the member to pay"
          captionClass="text-accent"
          active={tab === "quote_sent"}
          onClick={() => setTab("quote_sent")}
          delay={160}
        />
        <StatTile
          icon={<CheckCircle2 size={20} />}
          iconClass="bg-gradient-to-br from-lime to-[#a6dc4c] text-primary"
          label="Paid"
          value={stats?.paid}
          caption={
            stats?.averageRating != null
              ? `★ ${stats.averageRating} avg · ${stats.ratingCount} rating${stats.ratingCount === 1 ? "" : "s"}`
              : "To deliver, then close"
          }
          captionClass="text-emerald-700"
          active={tab === "paid"}
          onClick={() => setTab("paid")}
          delay={220}
        />
      </div>

      <section className="animate-enter rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04]" style={{ animationDelay: "260ms" }}>
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-divider p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-full border border-divider bg-background px-4 py-2.5 transition-all focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent/10">
              <Search size={15} className="shrink-0 text-subtle" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by request ID, service or member…"
                aria-label="Search requests"
                className="w-full bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
              />
              {searchInput && (
                <button type="button" onClick={() => { setSearchInput(""); setSearch(""); }} aria-label="Clear search" className="text-subtle transition-colors hover:text-primary">
                  <X size={14} />
                </button>
              )}
            </div>
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

          <div role="group" aria-label="Show requests" className="flex w-fit max-w-full flex-wrap rounded-full bg-background p-1">
            <TabButton active={tab === "all"} label="All" count={total} onClick={() => setTab("all")} />
            <TabButton active={tab === "unassigned"} label="Unassigned" count={stats?.unassigned} onClick={() => setTab("unassigned")} />
            <TabButton active={tab === "mine"} label="Mine" count={stats?.mine} onClick={() => setTab("mine")} />
            <TabButton active={tab === "requested"} label="Requested" count={stats?.requested} onClick={() => setTab("requested")} />
            <TabButton active={tab === "quote_sent"} label="Quote sent" count={stats?.quoteSent} onClick={() => setTab("quote_sent")} />
            <TabButton active={tab === "paid"} label="Paid" count={stats?.paid} onClick={() => setTab("paid")} />
            <TabButton active={tab === "closed"} label="Closed" count={stats?.closed} onClick={() => setTab("closed")} />
            {needsReview > 0 && <TabButton alert active={tab === "review"} label="Needs review" count={needsReview} onClick={() => setTab("review")} />}
          </div>
        </div>

        {/* List */}
        {firstLoad ? (
          <div className="space-y-3 p-5" aria-label="Loading requests">
            {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : error ? (
          <EmptyState icon={<SearchX size={20} />}>
            <span className="flex flex-col items-center gap-3">
              Couldn&apos;t load requests.
              <button
                onClick={() => { setLoadedKey(null); pagesLoaded.current = 1; load(1); }}
                className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
              >
                Retry
              </button>
            </span>
          </EmptyState>
        ) : requests.length === 0 && !refreshing ? (
          <EmptyState icon={hasFilters || tab !== "all" || serviceId ? <SearchX size={20} /> : <Inbox size={20} />}>
            <span className="flex flex-col items-center gap-3">
              {hasFilters || tab !== "all" || serviceId
                ? "No requests match these filters."
                : "No requests yet. They'll appear here when a member requests a service from the app."}
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
                {["Request", "Member", "Service", "Quote", "Status", "Rating", "Last update"].map((h) => (
                  <span key={h} className={`${TH} !p-0`} role="columnheader">{h}</span>
                ))}
              </div>

              {requests.map((r, i) => {
                const unread = r.unreadCount > 0;
                const quoted = r.quote && (r.quote.status === "active" || r.quote.status === "paid");
                return (
                  <Link
                    key={r.id}
                    href={`/admin/services/${r.id}`}
                    style={stagger(Math.min(i, 8), 0, 35)}
                    title={`${r.service.title} · ${r.assignedAdmin ? `Assigned to ${r.assignedAdmin.name}` : "Unassigned"}`}
                    className={`${GRID} animate-fade group relative border-b border-divider/70 px-4 py-3.5 text-sm text-primary transition-colors last:border-b-0 hover:bg-background/60 ${focusRing} ${
                      unread ? "bg-accent/[0.04]" : ""
                    }`}
                  >
                    {/* Unread: a teal edge on the row, plus the count for screen readers. */}
                    {unread && <span aria-hidden className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-accent" />}
                    <span className="flex items-center gap-2 font-bold tabular-nums transition-colors group-hover:text-accent">
                      #{r.label}
                      {unread && (
                        <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white" aria-label={`${r.unreadCount} unread`}>
                          {r.unreadCount}
                        </span>
                      )}
                      {r.requiresReview && <AlertTriangle size={13} className="text-red-500" aria-label="Payment needs review" />}
                    </span>
                    <span className="flex min-w-0 items-center gap-3">
                      <TintAvatar name={r.user.name} className="h-9 w-9" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{r.user.name}</span>
                        <span className={`block truncate text-[11px] ${r.assignedAdmin ? "text-muted" : "font-semibold text-rose-500"}`}>
                          {r.assignedAdmin ? `Assigned to ${r.assignedAdmin.name}` : "Unassigned"}
                        </span>
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate ${unread ? "font-bold" : "font-medium"}`}>{r.service.title}</span>
                      {/* What the member said they need — the first thing support wants to know. */}
                      <span className="block truncate text-[11px] text-muted">{r.needs}</span>
                    </span>
                    <span className="min-w-0">
                      {quoted && r.quote ? (
                        <>
                          <span className="block truncate font-semibold tabular-nums">{formatInr(r.quote.totalAmount)}</span>
                          <span className={`block text-[11px] font-medium ${r.quote.status === "paid" ? "text-emerald-700" : "text-amber-700"}`}>
                            {r.quote.status === "paid" ? "Paid" : "Awaiting payment"}
                          </span>
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <RequestStatusBadge status={r.status} closedReason={r.closedReason} />
                      {r.invoice && <FileText size={13} className="text-muted" aria-label={`Invoice ${r.invoice.number}`} />}
                    </span>
                    <span className="text-sm font-semibold">
                      {r.rating !== null ? (
                        <span className="flex items-center gap-1 text-primary">
                          <Star size={13} className="text-amber-500" fill="currentColor" /> {r.rating}
                        </span>
                      ) : (
                        <span className="font-normal text-subtle">—</span>
                      )}
                    </span>
                    <span className="whitespace-nowrap text-xs text-muted">{timeAgo(r.lastMessageAt, now)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        {!firstLoad && !error && requests.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-5 py-4">
            <p className="text-sm text-muted">
              Showing <span className="font-semibold tabular-nums text-primary">{requests.length}</span> request{requests.length === 1 ? "" : "s"}
              {nextCursor ? "" : " — that's all of them"}
            </p>
            {nextCursor && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-full border border-divider bg-white px-5 py-2 text-sm font-semibold text-primary transition-all hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {loadingMore && <Loader2 size={14} className="animate-spin" />}
                Load more
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default function AdminServicesPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6">
          <Skeleton className="h-16 w-72" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        </div>
      }
    >
      <AdminServicesInbox />
    </Suspense>
  );
}
