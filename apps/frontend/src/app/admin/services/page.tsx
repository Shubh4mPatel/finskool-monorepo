"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Briefcase, ChevronRight, FileText, Inbox, Loader2, Search, Settings2, Star } from "lucide-react";
import { api } from "@/lib/api";
import { useIsSuperAdmin } from "@/lib/session";
import { formatInr } from "@/lib/services";
import type { AdminServiceRequest, ServiceStats } from "@/lib/services";
import { timeAgo } from "@/lib/tickets";
import type { TicketPage } from "@/lib/tickets";
import { ticketSocketStore } from "@/store/tickets/ticketSocketStore";
import { Avatar } from "@/components/admin/tickets/TicketBadges";
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
const GRID = "grid grid-cols-[100px_minmax(150px,1fr)_minmax(180px,1.4fr)_120px_150px_70px_110px] items-center gap-4";

function Pill({ active, label, count, onClick, alert = false }: { active: boolean; label: string; count?: number; onClick: () => void; alert?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors ${
        active ? "border-primary bg-primary text-white" : alert ? "border-[#f3b6c0] bg-[#fff0f2] text-[#e11d48]" : "border-[#dcd9d0] bg-white text-primary hover:border-accent"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? "bg-lime text-primary" : alert ? "bg-white text-[#e11d48]" : "bg-background text-primary"}`}>{count}</span>
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

export default function AdminServicesPage() {
  const isSuperAdmin = useIsSuperAdmin();

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

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), ...tabParams(tab) });
      if (unreadOnly) params.set("unread", "true");
      if (search) params.set("search", search);
      if (cursor) params.set("cursor", cursor);
      return params.toString();
    },
    [tab, unreadOnly, search],
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
  const dash = "–";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1 text-xs font-semibold text-accent">
            Dashboard <ChevronRight size={12} /> Services
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-primary">Services</h1>
          <p className="mt-1 text-sm text-muted">Requests members raise for your services — agree the scope in chat, send a quote, get paid, deliver.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/services/catalog"
            className="flex h-11 items-center gap-2 rounded-full border border-[#dcd9d0] bg-white px-5 text-sm font-semibold text-primary transition-colors hover:border-accent"
          >
            <Briefcase size={15} /> Service catalog
          </Link>
          {isSuperAdmin && (
            <Link
              href="/admin/settings/billing"
              className="flex h-11 items-center gap-2 rounded-full border border-[#dcd9d0] bg-white px-5 text-sm font-semibold text-primary transition-colors hover:border-accent"
            >
              <Settings2 size={15} /> Billing settings
            </Link>
          )}
        </div>
      </div>

      {stats && stats.needsReview > 0 && (
        <button
          onClick={() => setTab("review")}
          className="flex items-center gap-3 rounded-2xl border border-[#f3b6c0] bg-[#fff0f2] px-5 py-3 text-left text-sm text-[#9f1239] transition-colors hover:bg-[#ffe6ea]"
        >
          <AlertTriangle size={18} className="shrink-0" />
          <span>
            <strong>
              {stats.needsReview} payment{stats.needsReview === 1 ? "" : "s"} need{stats.needsReview === 1 ? "s" : ""} review.
            </strong>{" "}
            Money arrived that could not be applied to a request — refund it in the Razorpay dashboard, then mark it resolved.
          </span>
        </button>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Unassigned" value={stats?.unassigned ?? dash} caption="Waiting for someone to pick up" captionClass="text-[#e11d48]" />
        <StatCard
          label="My open requests"
          value={stats?.mine ?? dash}
          caption={stats?.mineUnread ? `${stats.mineUnread} with new messages` : "Assigned to you"}
          captionClass="text-[#a16207]"
        />
        <StatCard label="Quote sent" value={stats?.quoteSent ?? dash} caption="Waiting for the member to pay" captionClass="text-[#1d4ed8]" />
        <StatCard
          label="Paid"
          value={stats?.paid ?? dash}
          caption={stats?.averageRating != null ? `★ ${stats.averageRating} avg · ${stats.ratingCount} rating${stats.ratingCount === 1 ? "" : "s"}` : "To deliver, then close"}
          captionClass="text-[#16a34a]"
        />
      </div>

      <section className="rounded-3xl bg-white px-7 py-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-primary">Service requests</h2>
            <p className="mt-1 text-sm text-muted">Created when a member requests one of your services from the mobile app.</p>
          </div>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by request ID, service or member"
              className="h-11 w-80 rounded-full border border-[#dcd9d0] bg-white pl-11 pr-4 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Pill active={tab === "all"} label="All" count={total} onClick={() => setTab("all")} />
            <Pill active={tab === "unassigned"} label="Unassigned" count={stats?.unassigned} onClick={() => setTab("unassigned")} />
            <Pill active={tab === "mine"} label="Mine" count={stats?.mine} onClick={() => setTab("mine")} />
            <Pill active={tab === "requested"} label="Requested" count={stats?.requested} onClick={() => setTab("requested")} />
            <Pill active={tab === "quote_sent"} label="Quote sent" count={stats?.quoteSent} onClick={() => setTab("quote_sent")} />
            <Pill active={tab === "paid"} label="Paid" count={stats?.paid} onClick={() => setTab("paid")} />
            <Pill active={tab === "closed"} label="Closed" count={stats?.closed} onClick={() => setTab("closed")} />
            {(stats?.needsReview ?? 0) > 0 && <Pill active={tab === "review"} label="Needs review" count={stats?.needsReview} alert onClick={() => setTab("review")} />}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-primary">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="h-4 w-4 accent-primary" />
            Unread only
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          <div className="min-w-205">
            <div className={`${GRID} rounded-xl bg-background px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted`}>
              <span>Request</span>
              <span>Member</span>
              <span>Service</span>
              <span>Quote</span>
              <span>Status</span>
              <span>Rating</span>
              <span>Last update</span>
            </div>

            {loading ? (
              <div className="flex justify-center py-16 text-muted"><Loader2 className="animate-spin" /></div>
            ) : error ? (
              <div className="py-16 text-center">
                <p className="text-sm font-semibold text-primary">Couldn&apos;t load requests</p>
                <button
                  onClick={() => { setLoadedKey(null); pagesLoaded.current = 1; load(1); }}
                  className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-bold text-white"
                >
                  Retry
                </button>
              </div>
            ) : requests.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <Inbox size={28} className="text-subtle" />
                <p className="text-sm font-semibold text-primary">No requests here</p>
                <p className="text-xs text-muted">Nothing matches the current filters.</p>
              </div>
            ) : (
              requests.map((r) => (
                <Link
                  key={r.id}
                  href={`/admin/services/${r.id}`}
                  title={`${r.service.title} · ${r.assignedAdmin ? `Assigned to ${r.assignedAdmin.name}` : "Unassigned"}`}
                  className={`${GRID} border-b border-divider px-4 py-3 text-sm text-primary transition-colors last:border-b-0 hover:bg-background/70`}
                >
                  <span className="flex items-center gap-2 font-bold">
                    #{r.label}
                    {r.unreadCount > 0 && <span className="h-2 w-2 rounded-full bg-accent" aria-label={`${r.unreadCount} unread`} />}
                    {r.requiresReview && <AlertTriangle size={13} className="text-[#e11d48]" aria-label="Payment needs review" />}
                  </span>
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={r.user.name} />
                    <span className="truncate font-medium">{r.user.name}</span>
                  </span>
                  <span className={`truncate ${r.unreadCount > 0 ? "font-semibold" : ""}`}>{r.service.title}</span>
                  <span className="truncate text-primary/80">
                    {r.quote && (r.quote.status === "active" || r.quote.status === "paid") ? formatInr(r.quote.totalAmount) : <span className="text-subtle">—</span>}
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
                  <span className="text-muted">{timeAgo(r.lastMessageAt, now)}</span>
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
