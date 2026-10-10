"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, HandHelping, Loader2, UserRoundCog } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getSession } from "@/lib/session";
import {
  CATEGORY_LABEL,
  TYPE_LABEL,
  formatTicketTime,
  type AdminTicketDetail,
  type AdminTicketEvent,
  type TicketMessage,
  type TicketPage,
} from "@/lib/tickets";
import { ticketSocketStore } from "@/store/tickets/ticketSocketStore";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Chip, Stars, StatusBadge } from "@/components/admin/tickets/TicketBadges";
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

function eventText(e: AdminTicketEvent): string {
  switch (e.type) {
    case "created":
      return `Ticket created by ${e.actorName}`;
    case "assigned":
      return e.targetName && e.targetName !== e.actorName
        ? `Assigned to ${e.targetName} by ${e.actorName}`
        : `${e.actorName} took the ticket`;
    case "reassigned":
      return `Reassigned to ${e.targetName ?? "another admin"} by ${e.actorName}`;
    case "resolved":
      return `Resolved by ${e.actorName}`;
  }
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
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState<"claim" | "resolve" | "reassign" | null>(null);

  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [reassignTo, setReassignTo] = useState("");

  const refreshTicket = useCallback(async () => {
    try {
      setTicket(await api.get<AdminTicketDetail>(`${BASE}/${ticketId}`));
    } catch {
      // keep what we have; the next event / action retries
    }
  }, [ticketId]);

  // Initial load: ticket + newest page of messages.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [t, page] = await Promise.all([
          api.get<AdminTicketDetail>(`${BASE}/${ticketId}`),
          api.get<TicketPage<TicketMessage>>(`${BASE}/${ticketId}/messages?limit=30`),
        ]);
        if (cancelled) return;
        setTicket(t);
        setMessages(mergeMessages([], page.items));
        setOlderCursor(page.nextCursor);
      } catch (err) {
        if (!cancelled && err instanceof ApiError && err.status === 404) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

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
      api
        .get<TicketPage<TicketMessage>>(`${BASE}/${ticketId}/messages?limit=30`)
        .then((page) => setMessages((prev) => mergeMessages(prev, page.items)))
        .catch(() => {});
    });
    return () => {
      off();
      offReconnect();
    };
  }, [ticketId, refreshTicket]);

  // Clear the unread badge while the assignee has the ticket open.
  const assigneeId = ticket?.assignedAdmin?.id;
  const unread = ticket?.unreadCount ?? 0;
  useEffect(() => {
    if (!meId || assigneeId !== meId || unread === 0) return;
    api
      .post(`${BASE}/${ticketId}/read`, {})
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
      const page = await api.get<TicketPage<TicketMessage>>(
        `${BASE}/${ticketId}/messages?limit=30&before=${encodeURIComponent(olderCursor)}`,
      );
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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4">
      <Link href="/admin/tickets" className="flex w-fit items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
        <ArrowLeft size={14} /> Support Tickets
      </Link>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* Conversation */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-card">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-divider px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-accent">{ticket.label}</p>
              <h1 className="font-display text-lg font-bold text-primary wrap-break-word">{ticket.subject}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={ticket.status} />
                <Chip>{CATEGORY_LABEL[ticket.category]}</Chip>
                <Chip>{TYPE_LABEL[ticket.type]}</Chip>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canClaim && (
                <button
                  onClick={() => runAction("claim", () => api.post(`${BASE}/${ticketId}/claim`, {}), "Ticket assigned to you")}
                  disabled={acting !== null}
                  className="flex items-center gap-2 rounded-full border border-primary px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
                >
                  {acting === "claim" ? <Loader2 size={14} className="animate-spin" /> : <HandHelping size={14} />}
                  Take ticket
                </button>
              )}
              {ticket.canResolve && (
                <button
                  onClick={handleResolve}
                  disabled={acting !== null}
                  className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-white shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                >
                  {acting === "resolve" ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Resolve
                </button>
              )}
            </div>
          </header>

          <TicketChat
            ticket={ticket}
            messages={messages}
            hasOlder={olderCursor !== null}
            loadingOlder={loadingOlder}
            onLoadOlder={loadOlder}
            onSent={(m) => {
              setMessages((prev) => mergeMessages(prev, [m]));
              refreshTicket();
            }}
            currentUserId={me?.userId ?? ""}
          />
        </section>

        {/* Details */}
        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <div className="rounded-2xl bg-white px-5 py-4 shadow-card">
            <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Member</h2>
            <p className="mt-2 text-sm font-bold text-primary">{ticket.user.name}</p>
            <p className="text-xs text-muted">{ticket.user.phone}</p>
            <dl className="mt-3 flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-muted">Community</dt><dd className="font-semibold text-primary">{ticket.communityName}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Raised</dt><dd className="font-semibold text-primary">{formatTicketTime(ticket.createdAt)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Assigned to</dt><dd className="font-semibold text-primary">{ticket.assignedAdmin?.name ?? "Unassigned"}</dd></div>
            </dl>
          </div>

          {me?.isSuperAdmin && open && (
            <div className="rounded-2xl bg-white px-5 py-4 shadow-card">
              <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Reassign</h2>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="mt-2 w-full rounded-full border border-divider bg-white px-3 py-2 text-sm text-primary outline-none focus:border-accent"
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
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-primary px-4 py-2 text-sm font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-40"
              >
                {acting === "reassign" ? <Loader2 size={14} className="animate-spin" /> : <UserRoundCog size={14} />}
                Reassign
              </button>
            </div>
          )}

          {ticket.status === "resolved" && (
            <div className="rounded-2xl bg-white px-5 py-4 shadow-card">
              <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Member rating</h2>
              {ticket.rating !== null ? (
                <>
                  <div className="mt-2"><Stars value={ticket.rating} /></div>
                  {ticket.ratingComment && <p className="mt-2 text-sm text-primary wrap-break-word">&ldquo;{ticket.ratingComment}&rdquo;</p>}
                  {ticket.ratedAt && <p className="mt-1 text-[11px] text-subtle">{formatTicketTime(ticket.ratedAt)}</p>}
                </>
              ) : (
                <p className="mt-2 text-xs text-muted">Not rated yet.</p>
              )}
            </div>
          )}

          <div className="rounded-2xl bg-white px-5 py-4 shadow-card">
            <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Timeline</h2>
            <ol className="mt-3 flex flex-col gap-3 border-l border-divider pl-4">
              {ticket.events.map((e) => (
                <li key={e.id} className="relative text-xs">
                  <span className="absolute -left-5.25 top-1 h-2 w-2 rounded-full bg-accent" />
                  <p className="font-semibold text-primary">{eventText(e)}</p>
                  <p className="text-[11px] text-subtle">{formatTicketTime(e.createdAt)}</p>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
