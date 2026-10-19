"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, Download, HandHelping, Loader2, UserRoundCog, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { formatInr } from "@/lib/services";
import type { AdminServiceRequest, AdminServiceRequestDetail, QuoteDefaults, ServiceMessage } from "@/lib/services";
import { formatLongTime, timeAgo } from "@/lib/tickets";
import type { TicketPage } from "@/lib/tickets";
import { ticketSocketStore, TicketSocketError } from "@/store/tickets/ticketSocketStore";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Stars } from "@/components/admin/tickets/TicketBadges";
import { QuoteStatusPill, RequestStatusBadge } from "@/components/admin/services/ServiceBadges";
import ServiceChat from "@/components/admin/services/ServiceChat";
import SendQuoteModal from "@/components/admin/services/SendQuoteModal";

const BASE = "/api/v1/admin/services";

interface AdminOption {
  id: string;
  name: string;
  isSuperAdmin: boolean;
}

function mergeMessages(existing: ServiceMessage[], incoming: ServiceMessage[]): ServiceMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  // Later copies win, so a quote card refreshed from the server replaces its stale status.
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
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

export default function AdminServiceRequestPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const confirm = useConfirm();
  const toast = useToast();
  const me = getSession();
  // getSession() returns a fresh object each call — effects must depend on primitives, not on `me`.
  const meId = me?.userId;

  const [request, setRequest] = useState<AdminServiceRequestDetail | null>(null);
  const [messages, setMessages] = useState<ServiceMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [acting, setActing] = useState<"claim" | "close" | "reassign" | "review" | "invoice" | null>(null);
  const [previous, setPrevious] = useState<AdminServiceRequest[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [reassignTo, setReassignTo] = useState("");
  const [quoteDefaults, setQuoteDefaults] = useState<QuoteDefaults | null>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);

  // Keeps "Last message 12 min ago" style labels from going stale while the page stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const refreshRequest = useCallback(async () => {
    try {
      setRequest(await api.get<AdminServiceRequestDetail>(`${BASE}/${requestId}`));
      setNow(Date.now());
    } catch {
      // keep what we have; the next event / action retries
    }
  }, [requestId]);

  // Initial load: the request over REST; the chat history over the socket (independent of each other,
  // so a slow or failed socket never hides the request).
  useEffect(() => {
    let cancelled = false;
    api
      .get<AdminServiceRequestDetail>(`${BASE}/${requestId}`)
      .then((r) => {
        if (!cancelled) setRequest(r);
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
  }, [requestId]);

  // Newest page of messages. `initial` also sets the paging cursor; a re-sync after an event or a
  // reconnect only merges (and refreshes the status of quote cards already on screen).
  const loadLatest = useCallback(
    async (initial: boolean) => {
      try {
        const page = await ticketSocketStore.request<TicketPage<ServiceMessage>>("service.history.get", { requestId, limit: 30 });
        setMessages((prev) => mergeMessages(prev, page.items));
        if (initial) setOlderCursor(page.nextCursor);
        setHistoryError(false);
      } catch (err) {
        if (!(err instanceof TicketSocketError && err.code === "HTTP_404")) setHistoryError(true);
      }
    },
    [requestId],
  );

  // Initial history (same as loadLatest(true), inline so the effect doesn't set state synchronously).
  useEffect(() => {
    let cancelled = false;
    ticketSocketStore
      .request<TicketPage<ServiceMessage>>("service.history.get", { requestId, limit: 30 })
      .then((page) => {
        if (cancelled) return;
        setMessages((prev) => mergeMessages(prev, page.items));
        setOlderCursor(page.nextCursor);
        setHistoryError(false);
      })
      .catch((err) => {
        if (!cancelled && !(err instanceof TicketSocketError && err.code === "HTTP_404")) setHistoryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  // The member's other requests.
  const memberId = request?.user.id;
  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    api
      .get<TicketPage<AdminServiceRequest>>(`${BASE}?userId=${memberId}&limit=6`)
      .then((page) => {
        if (!cancelled) setPrevious(page.items.filter((r) => r.id !== requestId).slice(0, 5));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [memberId, requestId]);

  // Super admins can reassign: load the admin roster once. Defaults feed the send-quote form.
  useEffect(() => {
    if (!me?.isSuperAdmin) return;
    api
      .get<AdminOption[]>("/api/v1/admin/admins")
      .then(setAdmins)
      .catch(() => {});
  }, [me?.isSuperAdmin]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<QuoteDefaults>(`${BASE}/quote-defaults`)
      .then((d) => {
        if (!cancelled) setQuoteDefaults(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates for this request: new messages, quote cards changing state, payments, status changes.
  useEffect(() => {
    ticketSocketStore.connect();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const resync = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        refreshRequest();
        loadLatest(false);
      }, 250);
    };
    const off = ticketSocketStore.subscribeServices((ev) => {
      if (ev.requestId !== requestId) return;
      if (ev.event === "service.message") setMessages((prev) => mergeMessages(prev, [ev.data.message]));
      if (ev.event !== "service.read") resync();
    });
    // After a dropped connection we may have missed events — re-sync.
    const offReconnect = ticketSocketStore.onReconnect(resync);
    return () => {
      off();
      offReconnect();
      if (timer) clearTimeout(timer);
    };
  }, [requestId, refreshRequest, loadLatest]);

  // Clear the unread badge while the assignee has the request open.
  const assigneeId = request?.assignedAdmin?.id;
  const unread = request?.unreadCount ?? 0;
  useEffect(() => {
    if (!meId || assigneeId !== meId || unread === 0) return;
    ticketSocketStore
      .request("service.read", { requestId })
      .then(() => {
        setRequest((r) => (r ? { ...r, unreadCount: 0 } : r));
        window.dispatchEvent(new Event("admin-services:updated"));
      })
      .catch(() => {});
  }, [requestId, assigneeId, unread, meId]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await ticketSocketStore.request<TicketPage<ServiceMessage>>("service.history.get", { requestId, limit: 30, before: olderCursor });
      setMessages((prev) => mergeMessages(prev, page.items));
      setOlderCursor(page.nextCursor);
    } catch {
      toast.error("Couldn't load earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  }, [olderCursor, loadingOlder, requestId, toast]);

  // Guards against double-clicks: a second click while one is in flight is ignored.
  const actingRef = useRef(false);
  async function runAction(kind: "claim" | "close" | "reassign" | "review", fn: () => Promise<unknown>, okMessage: string) {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(kind);
    try {
      await fn();
      toast.success(okMessage);
      await refreshRequest();
      window.dispatchEvent(new Event("admin-services:updated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      await refreshRequest();
    } finally {
      actingRef.current = false;
      setActing(null);
    }
  }

  async function handleClose() {
    if (!request) return;
    const delivered = request.status === "paid";
    const ok = await confirm({
      variant: delivered ? "positive" : "destructive",
      title: delivered ? "Mark as delivered and close" : "Decline and close",
      message: delivered ? (
        <>
          Close <strong className="text-primary">{request.label}</strong> as completed? The chat will be locked, and the member can rate the service.
        </>
      ) : (
        <>
          Decline <strong className="text-primary">{request.label}</strong> and close it? The chat will be locked and any quote still waiting for payment is withdrawn. This can&apos;t be undone.
        </>
      ),
      confirmLabel: delivered ? "Close as completed" : "Decline and close",
      icon: delivered ? <CheckCircle2 size={22} /> : <XCircle size={22} />,
    });
    if (!ok) return;
    runAction("close", () => api.post(`${BASE}/${requestId}/close`, {}), delivered ? "Request closed as completed" : "Request declined and closed");
  }

  async function handleResolveReview() {
    const ok = await confirm({
      variant: "positive",
      title: "Mark payment review as resolved",
      message: "Have you already paid this member back in the Razorpay dashboard (or otherwise dealt with the payment)? The warning will be cleared.",
      confirmLabel: "Yes, resolved",
    });
    if (!ok) return;
    runAction("review", () => api.post(`${BASE}/${requestId}/review/resolve`, {}), "Payment review resolved");
  }

  async function downloadInvoice() {
    setActing("invoice");
    try {
      const { url } = await api.get<{ url: string }>(`${BASE}/${requestId}/invoice`);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't open the invoice. Please try again.");
    } finally {
      setActing(null);
    }
  }

  if (loading) {
    return <div className="flex justify-center py-24 text-muted"><Loader2 className="animate-spin" /></div>;
  }

  if (notFound || !request) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <p className="text-sm font-semibold text-primary">Request not found</p>
        <p className="text-xs text-muted">It may not exist or may have been removed.</p>
        <Link href="/admin/services" className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white">Back to services</Link>
      </div>
    );
  }

  const open = request.status !== "closed";
  const canClaim = open && !request.assignedAdmin;
  const eligibleAdmins = admins.filter((a) => a.id !== request.assignedAdmin?.id);
  // Events older than the oldest loaded message would float above an unloaded gap — show them once that history is loaded.
  const oldestLoaded = messages[0]?.createdAt;
  const visibleEvents = request.events.filter((e) => olderCursor === null || (oldestLoaded !== undefined && e.createdAt >= oldestLoaded));
  const captured = request.payments.filter((p) => p.status === "captured");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs font-semibold text-accent">
            Dashboard <ChevronRight size={12} />
            <Link href="/admin/services" className="hover:underline">Services</Link> <ChevronRight size={12} /> #{request.label}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-primary wrap-break-word">{request.service.title}</h1>
          <p className="mt-1 text-sm text-muted">Requested by {request.user.name} on {formatLongTime(request.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          {canClaim && (
            <button
              onClick={() => runAction("claim", () => api.post(`${BASE}/${requestId}/claim`, {}), "Request assigned to you")}
              disabled={acting !== null}
              className="flex h-11 items-center gap-2 rounded-full border border-primary px-5 text-sm font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
            >
              {acting === "claim" ? <Loader2 size={14} className="animate-spin" /> : <HandHelping size={14} />}
              Take request
            </button>
          )}
          {request.canClose && (
            <button
              onClick={handleClose}
              disabled={acting !== null}
              className={`flex h-11 items-center gap-2 rounded-full px-6 text-sm font-bold transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 ${
                request.status === "paid" ? "bg-linear-to-r from-lime to-accent text-primary shadow-glow" : "border border-[#dcd9d0] bg-white text-primary hover:border-accent"
              }`}
            >
              {acting === "close" && <Loader2 size={14} className="animate-spin" />}
              {request.status === "paid" ? "Mark delivered & close" : "Decline & close"}
            </button>
          )}
        </div>
      </div>

      {request.requiresReview && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f3b6c0] bg-[#fff0f2] px-5 py-4 text-sm text-[#9f1239]">
          <span className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>
              <strong>A payment needs your review.</strong> Money arrived that could not be applied to this request (for example the quote was replaced, expired or the request was cancelled while the member was paying).
              Pay it back in the Razorpay dashboard, then mark it resolved.
            </span>
          </span>
          <button
            onClick={handleResolveReview}
            disabled={acting !== null}
            className="flex h-10 items-center gap-2 rounded-full bg-[#e11d48] px-5 text-sm font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
          >
            {acting === "review" && <Loader2 size={14} className="animate-spin" />}
            Mark as resolved
          </button>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <ServiceChat
          request={request}
          messages={messages}
          events={visibleEvents}
          hasOlder={olderCursor !== null}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          historyError={historyError}
          onRetryHistory={() => loadLatest(messages.length === 0)}
          onSent={(m) => {
            setMessages((prev) => mergeMessages(prev, [m]));
            refreshRequest();
          }}
          onSendQuote={() => setQuoteOpen(true)}
          now={now}
        />

        <aside className="flex flex-col gap-5">
          <div className={card}>
            <h2 className={cardTitle}>Request details</h2>
            <div className="mt-4"><RequestStatusBadge status={request.status} closedReason={request.closedReason} /></div>
            <dl className="mt-5 flex flex-col gap-2.5 border-t border-divider pt-4">
              <Row label="Request ID">#{request.label}</Row>
              <Row label="Service">{request.service.title}</Row>
              <Row label="Member">{request.user.name}</Row>
              <Row label="Phone">{request.user.phone}</Row>
              <Row label="Requested on">{formatLongTime(request.createdAt)}</Row>
              <Row label="Assigned to">{request.assignedAdmin?.name ?? "Unassigned"}</Row>
              {request.paidAt && <Row label="Paid on">{formatLongTime(request.paidAt)}</Row>}
              {request.closedAt && <Row label="Closed on">{formatLongTime(request.closedAt)}</Row>}
              <Row label="Last update">{timeAgo(request.lastMessageAt, now)}</Row>
            </dl>
          </div>

          <div className={card}>
            <h2 className={cardTitle}>Quote &amp; payment</h2>
            {request.quotes.length === 0 ? (
              <p className="mt-3 text-xs text-muted">No quote sent yet. Use “Send quote” in the conversation once you have agreed the scope.</p>
            ) : (
              <>
                <ul className="mt-3 flex flex-col">
                  {[...request.quotes].reverse().map((q) => (
                    <li key={q.id} className="flex items-center justify-between gap-3 border-b border-divider py-2.5 last:border-b-0">
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-primary">#{q.version} · {formatInr(q.totalAmount)}</span>
                        <span className="block truncate text-[11px] text-muted">{formatInr(q.baseAmount)} + {q.gstRatePercent}% GST</span>
                      </span>
                      <QuoteStatusPill status={q.status} />
                    </li>
                  ))}
                </ul>
                {request.quote?.status === "active" && (
                  <p className="mt-3 text-[11px] text-muted">Valid until {formatLongTime(request.quote.expiresAt)}.</p>
                )}
              </>
            )}

            {request.payments.length > 0 && (
              <div className="mt-4 border-t border-divider pt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Payments</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {request.payments.map((p) => (
                    <li key={p.id} className="text-xs">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-bold text-primary">{formatInr(p.amount)}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${p.status === "captured" ? "bg-[#e4f7ea] text-[#16a34a]" : p.status === "failed" ? "bg-[#fff0f2] text-[#e11d48]" : "bg-[#f1efe6] text-muted"}`}>
                          {p.status}
                        </span>
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {p.method ?? "—"}{p.settledVia ? ` · confirmed by ${p.settledVia === "verify" ? "the app" : "Razorpay"}` : ""} · {p.razorpayPaymentId}
                      </span>
                      {p.errorDescription && <span className="block text-[11px] text-[#e11d48]">{p.errorDescription}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {request.invoice && (
              <div className="mt-4 border-t border-divider pt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">GST invoice</p>
                <p className="mt-1.5 text-sm font-bold text-primary">{request.invoice.number}</p>
                <p className="text-[11px] text-muted">{formatLongTime(request.invoice.issuedAt)} · {formatInr(request.invoice.total)}</p>
                <button
                  onClick={downloadInvoice}
                  disabled={acting !== null}
                  className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full border border-primary px-4 text-sm font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-40"
                >
                  {acting === "invoice" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Download PDF
                </button>
              </div>
            )}
            {captured.length === 0 && request.status === "quote_sent" && <p className="mt-3 text-[11px] text-muted">Waiting for the member to pay.</p>}
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
                  runAction("reassign", () => api.post(`${BASE}/${requestId}/reassign`, { adminId: reassignTo }), "Request reassigned").then(() => setReassignTo(""))
                }
                className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full border border-primary px-4 text-sm font-bold text-primary transition-colors hover:bg-primary/5 disabled:opacity-40"
              >
                {acting === "reassign" ? <Loader2 size={14} className="animate-spin" /> : <UserRoundCog size={14} />}
                Reassign
              </button>
            </div>
          )}

          {request.status === "closed" && request.closedReason === "completed" && (
            <div className={card}>
              <h2 className={cardTitle}>Member rating</h2>
              {request.rating !== null ? (
                <>
                  <div className="mt-3"><Stars value={request.rating} /></div>
                  {request.ratingComment && <p className="mt-2 text-sm text-primary wrap-break-word">&ldquo;{request.ratingComment}&rdquo;</p>}
                  {request.ratedAt && <p className="mt-1 text-[11px] text-subtle">{formatLongTime(request.ratedAt)}</p>}
                </>
              ) : (
                <p className="mt-2 text-xs text-muted">Not rated yet.</p>
              )}
            </div>
          )}

          <div className={card}>
            <h2 className={cardTitle}>Other requests</h2>
            {previous.length === 0 ? (
              <p className="mt-3 text-xs text-muted">No other requests from this member.</p>
            ) : (
              <ul className="mt-3 flex flex-col">
                {previous.map((r) => (
                  <li key={r.id} className="border-b border-divider last:border-b-0">
                    <Link href={`/admin/services/${r.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
                      <span className="min-w-0">
                        <span className="block text-xs font-bold text-primary">#{r.label}</span>
                        <span className="block truncate text-[11px] text-muted">{r.service.title}</span>
                      </span>
                      <RequestStatusBadge status={r.status} closedReason={r.closedReason} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {quoteOpen && quoteDefaults && (
        <SendQuoteModal
          requestId={requestId}
          memberName={request.user.name}
          defaults={quoteDefaults}
          onClose={() => setQuoteOpen(false)}
          onSent={() => {
            setQuoteOpen(false);
            refreshRequest();
            loadLatest(false);
            window.dispatchEvent(new Event("admin-services:updated"));
          }}
        />
      )}
    </div>
  );
}
