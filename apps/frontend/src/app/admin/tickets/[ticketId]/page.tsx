"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, HandHelping, History, Loader2, SearchX, Star as StarIcon, Ticket as TicketIcon, UserRoundCog } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getSession } from "@/lib/session";
import {
  CATEGORY_LABEL,
  TYPE_LABEL,
  formatLongTime,
  timeAgo,
  type AdminTicket,
  type AdminTicketDetail,
  type TicketMessage,
  type TicketPage,
} from "@/lib/tickets";
import { ticketSocketStore, TicketSocketError } from "@/store/tickets/ticketSocketStore";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Stars, StatusBadge } from "@/components/admin/tickets/TicketBadges";
import TicketChat from "@/components/admin/tickets/TicketChat";
import Select from "@/components/ui/Select";
import { EmptyState, Skeleton } from "@/components/admin/dashboard/Panel";
import { DetailRow, MemberBlock, SideCard, outlineBtn, solidBtn } from "@/components/admin/chat/DetailParts";

const BASE = "/api/v1/admin/tickets";

interface AdminOption {
  id: string;
  name: string;
  isSuperAdmin: boolean;
  communityAccess: { id: string }[];
}

function mergeMessages(existing: TicketMessage[], incoming: TicketMessage[]): TicketMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export default function AdminTicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const confirm = useConfirm();
  const toast = useToast();
  const me = getSession();
  // getSession() returns a fresh object each call — effects must depend on primitives, not on `me`.
  const meId = me?.userId;

  const [ticket, setTicket] = useState<AdminTicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState<"claim" | "resolve" | "reassign" | null>(null);
  const [previous, setPrevious] = useState<AdminTicket[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [reassignTo, setReassignTo] = useState("");

  // Keeps "Last reply 12 min ago" style labels from going stale while the page stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refreshTicket = useCallback(async () => {
    try {
      setTicket(await api.get<AdminTicketDetail>(`${BASE}/${ticketId}`));
      setNow(Date.now());
    } catch {
      // keep what we have; the next event / action retries
    }
  }, [ticketId]);

  // Initial load: the ticket record over REST; the chat history over the socket (independent of each other,
  // so a slow or failed socket never hides the ticket).
  useEffect(() => {
    let cancelled = false;
    api
      .get<AdminTicketDetail>(`${BASE}/${ticketId}`)
      .then((t) => {
        if (!cancelled) setTicket(t);
      })
      .catch((err) => {
        if (!cancelled && err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  // Newest page of messages. `initial` also sets the paging cursor; a re-sync after a reconnect only merges.
  const loadLatest = useCallback(
    async (initial: boolean) => {
      try {
        const page = await ticketSocketStore.request<TicketPage<TicketMessage>>("history.get", { ticketId, limit: 30 });
        setMessages((prev) => mergeMessages(prev, page.items));
        if (initial) setOlderCursor(page.nextCursor);
        setHistoryError(false);
      } catch (err) {
        if (!(err instanceof TicketSocketError && err.code === "NOT_FOUND")) setHistoryError(true);
      }
    },
    [ticketId],
  );

  // Initial history (same as loadLatest(true), inline so the effect doesn't set state synchronously).
  useEffect(() => {
    let cancelled = false;
    ticketSocketStore
      .request<TicketPage<TicketMessage>>("history.get", { ticketId, limit: 30 })
      .then((page) => {
        if (cancelled) return;
        setMessages((prev) => mergeMessages(prev, page.items));
        setOlderCursor(page.nextCursor);
        setHistoryError(false);
      })
      .catch((err) => {
        if (!cancelled && !(err instanceof TicketSocketError && err.code === "NOT_FOUND")) setHistoryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  // The member's other tickets (within communities this admin can see).
  const memberId = ticket?.user.id;
  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    api
      .get<TicketPage<AdminTicket>>(`${BASE}?userId=${memberId}&limit=6`)
      .then((page) => {
        if (!cancelled) setPrevious(page.items.filter((t) => t.id !== ticketId).slice(0, 5));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [memberId, ticketId]);

  // Super admins can reassign: load the admin roster once.
  useEffect(() => {
    if (!me?.isSuperAdmin) return;
    api
      .get<{ items: AdminOption[] }>("/api/v1/admin/admins")
      .then((res) => setAdmins(res.items))
      .catch(() => {});
  }, [me?.isSuperAdmin]);

  // Live updates for this ticket.
  useEffect(() => {
    ticketSocketStore.connect();
    const off = ticketSocketStore.subscribe((ev) => {
      if (ev.ticketId !== ticketId) return;
      if (ev.event === "ticket.message") {
        setMessages((prev) => mergeMessages(prev, [ev.data.message]));
        refreshTicket();
      } else if (ev.event === "ticket.updated") {
        refreshTicket();
      }
    });
    // After a dropped connection we may have missed messages — re-sync.
    const offReconnect = ticketSocketStore.onReconnect(() => {
      refreshTicket();
      loadLatest(false);
    });
    return () => {
      off();
      offReconnect();
    };
  }, [ticketId, refreshTicket, loadLatest]);

  // Clear the unread badge while the assignee has the ticket open.
  const assigneeId = ticket?.assignedAdmin?.id;
  const unread = ticket?.unreadCount ?? 0;
  useEffect(() => {
    if (!meId || assigneeId !== meId || unread === 0) return;
    ticketSocketStore
      .request("ticket.read", { ticketId })
      .then(() => {
        setTicket((t) => (t ? { ...t, unreadCount: 0 } : t));
        window.dispatchEvent(new Event("admin-tickets:updated"));
      })
      .catch(() => {});
  }, [ticketId, assigneeId, unread, meId]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await ticketSocketStore.request<TicketPage<TicketMessage>>("history.get", {
        ticketId,
        limit: 30,
        before: olderCursor,
      });
      setMessages((prev) => mergeMessages(prev, page.items));
      setOlderCursor(page.nextCursor);
    } catch {
      toast.error("Couldn't load earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  }, [olderCursor, loadingOlder, ticketId, toast]);

  // Guards against double-clicks: a second click while one is in flight is ignored.
  const actingRef = useRef(false);
  async function runAction(kind: "claim" | "resolve" | "reassign", fn: () => Promise<unknown>, okMessage: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(kind);
    try {
      await fn();
      toast.success(okMessage);
      await refreshTicket();
      window.dispatchEvent(new Event("admin-tickets:updated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      await refreshTicket();
    } finally {
      actingRef.current = false;
      setActing(null);
    }
  }

  async function handleResolve() {
    if (!ticket) return;
    const ok = await confirm({
      variant: "positive",
      title: "Resolve Ticket",
      message: (
        <>
          Mark <strong className="text-primary">{ticket.label}</strong> as resolved? The chat will be closed for both you and the member, and the
          ticket can&apos;t be reopened.
        </>
      ),
      confirmLabel: "Resolve",
      icon: <CheckCircle2 size={22} />,
    });
    if (!ok) return;
    runAction("resolve", () => api.post(`${BASE}/${ticketId}/resolve`, {}), "Ticket resolved");
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6" aria-label="Loading ticket">
        <Skeleton className="h-20 w-96 max-w-full" />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Skeleton className="h-[480px] rounded-2xl" />
          <div className="flex flex-col gap-5">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !ticket) {
    return (
      <div className="flex max-w-xl flex-col rounded-2xl bg-white shadow-card">
        <EmptyState icon={<SearchX size={20} />}>
          <span className="flex flex-col gap-1">
            <strong className="text-primary">Ticket not found</strong>
            It may not exist, or you don&apos;t have access to its community.
          </span>
        </EmptyState>
        <Link href="/admin/tickets" className="mb-8 self-center rounded-full bg-primary px-5 py-2 text-sm font-bold text-white transition-all hover:-translate-y-px hover:bg-[#1c4c48]">
          Back to tickets
        </Link>
      </div>
    );
  }

  const eligibleAdmins = admins.filter(
    (a) => a.id !== ticket.assignedAdmin?.id && (a.isSuperAdmin || a.communityAccess.some((c) => c.id === ticket.communityId)),
  );
  const open = ticket.status !== "resolved";
  const canClaim = open && !ticket.assignedAdmin;
  // Events older than the oldest loaded message would float above an unloaded gap — show them once that history is loaded.
  const oldestLoaded = messages[0]?.createdAt;
  const visibleEvents = ticket.events.filter((e) => olderCursor === null || (oldestLoaded !== undefined && e.createdAt >= oldestLoaded));

  return (
    <div className="flex flex-col gap-6">
      <div className="animate-enter flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/admin/tickets"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-primary shadow-card ring-1 ring-primary/[0.04] transition-all hover:-translate-x-0.5 hover:shadow-card-hover"
            >
              <ArrowLeft size={14} /> All tickets
            </Link>
            <p className="text-xs font-semibold text-accent">
              Dashboard &rsaquo; <Link href="/admin/tickets" className="hover:underline">Tickets</Link> &rsaquo; <span className="text-primary">#{ticket.label}</span>
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold text-primary wrap-break-word">{ticket.subject}</h1>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            Raised by <span className="font-semibold text-primary">{ticket.user.name}</span> on {formatLongTime(ticket.createdAt)} · {ticket.communityName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canClaim && (
            <button
              onClick={() => runAction("claim", () => api.post(`${BASE}/${ticketId}/claim`, {}), "Ticket assigned to you")}
              disabled={acting !== null}
              className={outlineBtn}
            >
              {acting === "claim" ? <Loader2 size={14} className="animate-spin" /> : <HandHelping size={14} />}
              Take ticket
            </button>
          )}
          {ticket.canResolve && (
            <button onClick={handleResolve} disabled={acting !== null} className={solidBtn}>
              {acting === "resolve" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} className="text-lime" />}
              Mark as resolved
            </button>
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="animate-enter min-w-0" style={{ animationDelay: "60ms" }}>
          <TicketChat
            ticket={ticket}
            messages={messages}
            events={visibleEvents}
            hasOlder={olderCursor !== null}
            loadingOlder={loadingOlder}
            onLoadOlder={loadOlder}
            historyError={historyError}
            onRetryHistory={() => loadLatest(messages.length === 0)}
            onSent={(m) => {
              setMessages((prev) => mergeMessages(prev, [m]));
              refreshTicket();
            }}
            now={now}
          />
        </div>

        <aside className="flex flex-col gap-5">
          <SideCard title="Ticket details" icon={<TicketIcon size={14} />} delay={100}>
            <MemberBlock name={ticket.user.name} phone={ticket.user.phone} />
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-background px-3 py-1 text-[11px] font-bold text-primary">{TYPE_LABEL[ticket.type]}</span>
              <span className="rounded-full bg-background px-3 py-1 text-[11px] font-bold text-primary">{CATEGORY_LABEL[ticket.category]}</span>
            </div>
            <dl className="mt-4 flex flex-col gap-2.5 border-t border-divider pt-4">
              <DetailRow label="Ticket ID"><span className="tabular-nums">#{ticket.label}</span></DetailRow>
              <DetailRow label="Community">{ticket.communityName}</DetailRow>
              <DetailRow label="Raised on">{formatLongTime(ticket.createdAt)}</DetailRow>
              <DetailRow label="Assigned to">
                {ticket.assignedAdmin?.name ?? <span className="text-rose-500">Unassigned</span>}
              </DetailRow>
              <DetailRow label="Last update">{timeAgo(ticket.lastMessageAt, now)}</DetailRow>
            </dl>
          </SideCard>

          {me?.isSuperAdmin && open && (
            <SideCard title="Reassign" icon={<UserRoundCog size={14} />} delay={140}>
              <Select
                value={reassignTo}
                onChange={setReassignTo}
                placeholder="Choose an admin…"
                ariaLabel="Admin to reassign to"
                className="w-full"
                triggerClassName="relative flex w-full items-center gap-2 text-left rounded-xl border border-divider bg-white px-3.5 py-2.5 text-sm text-primary transition-all focus:outline-none focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/10"
                options={eligibleAdmins.map((a) => ({ value: a.id, label: a.name }))}
              />
              <button
                disabled={!reassignTo || acting !== null}
                onClick={() =>
                  runAction(
                    "reassign",
                    () => api.post(`${BASE}/${ticketId}/reassign`, { adminId: reassignTo }),
                    "Ticket reassigned",
                  ).then(() => setReassignTo(""))
                }
                className={`${outlineBtn} mt-3 w-full`}
              >
                {acting === "reassign" ? <Loader2 size={14} className="animate-spin" /> : <UserRoundCog size={14} />}
                Reassign
              </button>
            </SideCard>
          )}

          {ticket.status === "resolved" && (
            <SideCard title="Member rating" icon={<StarIcon size={14} />} delay={180}>
              {ticket.rating !== null ? (
                <>
                  <Stars value={ticket.rating} />
                  {ticket.ratingComment && (
                    <p className="mt-2 rounded-xl bg-background px-3 py-2 text-sm text-primary wrap-break-word">&ldquo;{ticket.ratingComment}&rdquo;</p>
                  )}
                  {ticket.ratedAt && <p className="mt-1.5 text-[11px] text-subtle">{formatLongTime(ticket.ratedAt)}</p>}
                </>
              ) : (
                <p className="text-xs text-muted">Not rated yet.</p>
              )}
            </SideCard>
          )}

          <SideCard title="Previous tickets" icon={<History size={14} />} delay={220}>
            {previous.length === 0 ? (
              <p className="text-xs text-muted">No other tickets from this member.</p>
            ) : (
              <ul className="-mx-2 flex flex-col">
                {previous.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/admin/tickets/${t.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-background"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-bold tabular-nums text-primary">#{t.label}</span>
                        <span className="block truncate text-[11px] text-muted">{t.subject}</span>
                      </span>
                      <StatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SideCard>
        </aside>
      </div>
    </div>
  );
}
