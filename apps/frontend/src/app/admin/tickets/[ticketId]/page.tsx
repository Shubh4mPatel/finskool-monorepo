"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ChevronRight, HandHelping, Loader2, UserRoundCog } from "lucide-react";
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
  type TicketStatus,
  STATUS_LABEL,
} from "@/lib/tickets";
import { ticketSocketStore, TicketSocketError } from "@/store/tickets/ticketSocketStore";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Stars, StatusBadge } from "@/components/admin/tickets/TicketBadges";
import TicketChat from "@/components/admin/tickets/TicketChat";

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

const STATUS_DOT: Record<TicketStatus, string> = {
  open: "bg-[#e11d48]",
  in_progress: "bg-accent",
  resolved: "bg-[#16a34a]",
};

// Read-only value styled like the mockup's select fields (status/type/category aren't editable here —
// status moves via Take ticket / Mark as resolved, so no chevron that would suggest otherwise).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted">{label}</p>
      <div className="mt-1.5 flex items-center gap-2 rounded-xl border border-[#dcd9d0] bg-white px-3.5 py-2.5 text-sm font-medium text-primary">
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-semibold text-primary">{children}</dd>
    </div>
  );
}

const card = "rounded-3xl bg-white px-6 py-5 shadow-card";
const cardTitle = "font-display text-lg font-bold text-primary";

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

  useEffect(() => {
    loadLatest(true);
  }, [loadLatest]);

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
      .get<AdminOption[]>("/api/v1/admin/admins")
      .then(setAdmins)
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
    return <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>;
  }

  if (notFound || !ticket) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm font-semibold text-primary">Ticket not found</p>
        <p className="text-xs text-muted">It may not exist, or you don&apos;t have access to its community.</p>
        <Link href="/admin/tickets" className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Back to tickets</Link>
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs font-semibold text-accent">
            Dashboard <ChevronRight size={12} />
            <Link href="/admin/tickets" className="hover:underline">Tickets</Link> <ChevronRight size={12} /> #{ticket.label}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-primary wrap-break-word">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-muted">
            Raised by {ticket.user.name} on {formatLongTime(ticket.createdAt)} · {ticket.communityName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canClaim && (
            <button
              onClick={() => runAction("claim", () => api.post(`${BASE}/${ticketId}/claim`, {}), "Ticket assigned to you")}
              disabled={acting !== null}
              className="flex h-11 items-center gap-2 rounded-full border border-primary px-5 text-sm font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
            >
              {acting === "claim" ? <Loader2 size={14} className="animate-spin" /> : <HandHelping size={14} />}
              Take ticket
            </button>
          )}
          {ticket.canResolve && (
            <button
              onClick={handleResolve}
              disabled={acting !== null}
              className="flex h-11 items-center gap-2 rounded-full bg-linear-to-r from-lime to-accent px-6 text-sm font-bold text-primary shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            >
              {acting === "resolve" && <Loader2 size={14} className="animate-spin" />}
              Mark as resolved
            </button>
          )}
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
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

        <aside className="flex flex-col gap-5">
          <div className={card}>
            <h2 className={cardTitle}>Ticket details</h2>
            <div className="mt-4 flex flex-col gap-3.5">
              <Field label="Status">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[ticket.status]}`} />
                {STATUS_LABEL[ticket.status]}
              </Field>
              <Field label="Type">{TYPE_LABEL[ticket.type]}</Field>
              <Field label="Category">{CATEGORY_LABEL[ticket.category]}</Field>
            </div>
            <dl className="mt-5 flex flex-col gap-2.5 border-t border-divider pt-4">
              <Row label="Ticket ID">#{ticket.label}</Row>
              <Row label="Member">{ticket.user.name}</Row>
              <Row label="Phone">{ticket.user.phone}</Row>
              <Row label="Community">{ticket.communityName}</Row>
              <Row label="Raised on">{formatLongTime(ticket.createdAt)}</Row>
              <Row label="Assigned to">{ticket.assignedAdmin?.name ?? "Unassigned"}</Row>
              <Row label="Last update">{timeAgo(ticket.lastMessageAt, now)}</Row>
            </dl>
          </div>

          {me?.isSuperAdmin && open && (
            <div className={card}>
              <h2 className={cardTitle}>Reassign</h2>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="mt-3 w-full rounded-xl border border-[#dcd9d0] bg-white px-3.5 py-2.5 text-sm text-primary outline-none focus:border-accent"
              >
                <option value="">Choose an admin…</option>
                {eligibleAdmins.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <button
                disabled={!reassignTo || acting !== null}
                onClick={() =>
                  runAction(
                    "reassign",
                    () => api.post(`${BASE}/${ticketId}/reassign`, { adminId: reassignTo }),
                    "Ticket reassigned",
                  ).then(() => setReassignTo(""))
                }
                className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full border border-primary px-4 text-sm font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-40"
              >
                {acting === "reassign" ? <Loader2 size={14} className="animate-spin" /> : <UserRoundCog size={14} />}
                Reassign
              </button>
            </div>
          )}

          {ticket.status === "resolved" && (
            <div className={card}>
              <h2 className={cardTitle}>Member rating</h2>
              {ticket.rating !== null ? (
                <>
                  <div className="mt-3"><Stars value={ticket.rating} /></div>
                  {ticket.ratingComment && <p className="mt-2 text-sm text-primary wrap-break-word">&ldquo;{ticket.ratingComment}&rdquo;</p>}
                  {ticket.ratedAt && <p className="mt-1 text-[11px] text-subtle">{formatLongTime(ticket.ratedAt)}</p>}
                </>
              ) : (
                <p className="mt-2 text-xs text-muted">Not rated yet.</p>
              )}
            </div>
          )}

          <div className={card}>
            <h2 className={cardTitle}>Previous tickets</h2>
            {previous.length === 0 ? (
              <p className="mt-3 text-xs text-muted">No other tickets from this member.</p>
            ) : (
              <ul className="mt-3 flex flex-col">
                {previous.map((t) => (
                  <li key={t.id} className="border-b border-divider last:border-b-0">
                    <Link href={`/admin/tickets/${t.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-primary">#{t.label}</span>
                        <span className="block truncate text-[11px] text-muted">{t.subject}</span>
                      </span>
                      <StatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
