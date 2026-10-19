"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Receipt, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { ticketSocketStore, TicketSocketError } from "@/store/tickets/ticketSocketStore";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  fileExtension,
  formatBytes,
  formatChatTime,
  formatLongTime,
  formatTicketTime,
  randomId,
  timeAgo,
  type TicketAttachment,
} from "@/lib/tickets";
import { formatInr } from "@/lib/services";
import type { AdminServiceEvent, AdminServiceRequestDetail, ServiceMessage, ServiceQuote } from "@/lib/services";
import { Avatar } from "@/components/admin/tickets/TicketBadges";
import { QuoteStatusPill, RequestStatusBadge } from "@/components/admin/services/ServiceBadges";

const BASE = "/api/v1/admin/services";

function eventText(e: AdminServiceEvent): string | null {
  const actor = e.actorName ?? "Someone";
  switch (e.type) {
    case "assigned":
      return e.targetName && e.targetName !== e.actorName ? `Assigned to ${e.targetName} by ${actor}` : `${actor} took the request`;
    case "reassigned":
      return `Reassigned to ${e.targetName ?? "another admin"} by ${actor}`;
    case "closed": {
      const reason = (e.meta as { reason?: string } | null)?.reason;
      return reason === "completed" ? `${actor} marked the service as delivered and closed the request` : `${actor} declined and closed the request`;
    }
    case "cancelled":
      return `${actor} cancelled the request`;
    case "payment_flagged":
      return "A payment needs review";
    case "review_resolved":
      return `${actor} marked the payment review as resolved`;
    // The chat already shows these as cards / system messages.
    default:
      return null;
  }
}

function AttachmentCard({ requestId, attachment }: { requestId: string; attachment: TicketAttachment }) {
  const [url, setUrl] = useState(attachment.url);
  const [retried, setRetried] = useState(false);
  const isImage = attachment.mimeType.startsWith("image/");

  async function fresh(): Promise<string | null> {
    try {
      return (await api.get<{ url: string }>(`${BASE}/${requestId}/attachments/${attachment.id}/url`)).url;
    } catch {
      return null;
    }
  }

  // Signed links last ~5 min; ask for a fresh one right before opening.
  async function view() {
    window.open((await fresh()) ?? url, "_blank", "noopener,noreferrer");
  }

  async function refreshThumbnailOnce() {
    if (retried) return;
    setRetried(true);
    const next = await fresh();
    if (next) setUrl(next);
  }

  return (
    <div className="flex w-fit min-w-60 max-w-full items-center gap-3 rounded-xl bg-white px-3 py-2.5 text-primary shadow-sm">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={attachment.fileName} onError={refreshThumbnailOnce} className="h-9 w-9 shrink-0 rounded-md bg-background object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#dff1ee] text-[10px] font-bold text-accent">{fileExtension(attachment.fileName)}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold">{attachment.fileName}</span>
        <span className="block text-[11px] text-muted">{formatBytes(attachment.sizeBytes)}</span>
      </span>
      <button onClick={view} className="shrink-0 text-xs font-bold text-accent hover:underline">View</button>
    </div>
  );
}

/** The quote as the member sees it in their chat. Greyed out once it can no longer be paid. */
function QuoteCard({ quote }: { quote: ServiceQuote }) {
  const live = quote.status === "active" || quote.status === "paid";
  return (
    <div className={`w-72 max-w-full rounded-2xl border bg-white px-4 py-3.5 text-primary shadow-sm ${live ? "border-[#dcd9d0]" : "border-divider opacity-60"}`} aria-disabled={!live}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold"><Receipt size={13} /> Quote #{quote.version}</span>
        <QuoteStatusPill status={quote.status} />
      </div>
      <dl className="mt-3 flex flex-col gap-1.5 text-xs">
        <div className="flex justify-between"><dt className="text-muted">Service fee</dt><dd className="font-semibold">{formatInr(quote.baseAmount)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">GST @ {quote.gstRatePercent}%</dt><dd className="font-semibold">{formatInr(quote.gstAmount)}</dd></div>
        <div className="mt-1 flex justify-between border-t border-divider pt-2 text-sm"><dt className="font-bold">Total</dt><dd className="font-bold">{formatInr(quote.totalAmount)}</dd></div>
      </dl>
      {quote.note && <p className="mt-3 whitespace-pre-wrap wrap-break-word text-xs text-primary/80">{quote.note}</p>}
      <p className="mt-3 text-[11px] text-muted">
        {quote.status === "paid" ? "Paid" : quote.status === "active" ? `Valid until ${formatLongTime(quote.expiresAt)}` : `Was valid until ${formatLongTime(quote.expiresAt)}`}
      </p>
    </div>
  );
}

function MessageRow({
  requestId,
  message,
  name,
  isNew,
}: {
  requestId: string;
  message: Pick<ServiceMessage, "senderRole" | "createdAt" | "body" | "attachments" | "quote">;
  name: string;
  isNew: boolean;
}) {
  const admin = message.senderRole === "admin";
  const content = (
    <>
      {message.body && <p className="whitespace-pre-wrap wrap-break-word">{message.body}</p>}
      {message.attachments.map((a) => (
        <AttachmentCard key={a.id} requestId={requestId} attachment={a} />
      ))}
    </>
  );

  // A quote is the admin's, drawn as a card instead of a bubble.
  if (message.quote) {
    return (
      <div className="flex items-start justify-end gap-3">
        <div className="flex min-w-0 max-w-[80%] flex-col items-end">
          <p className="flex items-center gap-2 text-xs">
            <span className="font-bold text-primary">{name}</span>
            <span className="text-muted">Admin · {formatChatTime(message.createdAt)}</span>
          </p>
          <div className="mt-1.5"><QuoteCard quote={message.quote} /></div>
        </div>
        <Avatar name={name} dark className="h-9 w-9" />
      </div>
    );
  }

  if (admin) {
    return (
      <div className="flex items-start justify-end gap-3">
        <div className="flex min-w-0 max-w-[80%] flex-col items-end">
          <p className="flex items-center gap-2 text-xs">
            <span className="font-bold text-primary">{name}</span>
            <span className="text-muted">Admin · {formatChatTime(message.createdAt)}</span>
          </p>
          <div className="mt-1.5 flex flex-col items-end gap-3 rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-sm text-white">{content}</div>
        </div>
        <Avatar name={name} dark className="h-9 w-9" />
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <Avatar name={name} className="h-9 w-9" />
      <div className="min-w-0 max-w-[80%]">
        <p className="flex items-center gap-2 text-xs">
          <span className="font-bold text-primary">{name}</span>
          <span className="text-muted">Member · {formatChatTime(message.createdAt)}</span>
          {isNew && <span className="rounded-md bg-[#dff1ee] px-1.5 py-0.5 text-[10px] font-bold text-accent">New</span>}
        </p>
        <div className="mt-1.5 flex flex-col items-start gap-3 rounded-2xl rounded-tl-md bg-[#f1efe6] px-4 py-3 text-sm text-primary">{content}</div>
      </div>
    </div>
  );
}

interface PendingFile {
  localId: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  objectKey?: string;
}

type ThreadItem =
  | { kind: "message"; at: string; message: ServiceMessage }
  | { kind: "event"; at: string; event: AdminServiceEvent; text: string };

interface Props {
  request: AdminServiceRequestDetail;
  messages: ServiceMessage[]; // oldest -> newest
  events: AdminServiceEvent[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  historyError: boolean;
  onRetryHistory: () => void;
  onSent: (message: ServiceMessage) => void;
  onSendQuote: () => void;
  now: number;
}

export default function ServiceChat({ request, messages, events, hasOlder, loadingOlder, onLoadOlder, historyError, onRetryHistory, onSent, onSendQuote, now }: Props) {
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const prevScrollHeight = useRef<number | null>(null);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  // One key per logical message: reused on retry so a request that actually succeeded server-side
  // (but whose response was lost) is deduped instead of posted twice.
  const clientMessageId = useRef<string>(randomId());

  // Messages interleaved with the assignment / close events. Same-instant ties put the event first.
  const thread = useMemo<ThreadItem[]>(() => {
    const items: ThreadItem[] = [
      ...messages.map((message) => ({ kind: "message" as const, at: message.createdAt, message })),
      ...events.flatMap((event) => {
        const t = eventText(event);
        return t ? [{ kind: "event" as const, at: event.createdAt, event, text: t }] : [];
      }),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1));
  }, [messages, events]);

  const closed = request.status === "closed";
  // "New" = member messages nobody on the support side has answered yet.
  const lastAdminAt = useMemo(() => messages.filter((m) => m.senderRole === "admin").at(-1)?.createdAt ?? null, [messages]);
  const isAwaiting = (at: string) => !closed && (lastAdminAt === null || at > lastAdminAt);

  const updates = thread.length;
  const lastMessage = messages.filter((m) => m.senderRole !== "system").at(-1);

  // Keep the view pinned to the newest message unless the admin scrolled up; when older messages are
  // prepended, hold the viewport where it was.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prevScrollHeight.current !== null) {
      el.scrollTop = el.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [thread]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function loadOlder() {
    prevScrollHeight.current = scrollRef.current?.scrollHeight ?? null;
    onLoadOlder();
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    if (fileRef.current) fileRef.current.value = "";
    if (files.length + picked.length > MAX_ATTACHMENTS) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files per message.`);
      return;
    }
    for (const file of picked) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} is larger than 5 MB.`);
        continue;
      }
      if (!ATTACHMENT_ACCEPT.split(",").includes(file.type)) {
        toast.error(`${file.name}: only JPG, PNG, WebP or PDF files are allowed.`);
        continue;
      }
      const localId = randomId();
      setFiles((prev) => [...prev, { localId, name: file.name, size: file.size, status: "uploading" }]);
      try {
        const { uploadUrl, objectKey } = await api.post<{ uploadUrl: string; objectKey: string }>(`${BASE}/attachments/presign`, { fileName: file.name, sizeBytes: file.size });
        const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!res.ok) throw new Error("upload failed");
        setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, status: "ready", objectKey } : f)));
      } catch {
        setFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, status: "error" } : f)));
        toast.error(`Couldn't upload ${file.name}.`);
      }
    }
  }

  const uploading = files.some((f) => f.status === "uploading");
  const ready = files.filter((f) => f.status === "ready");
  const canSend = !sending && !uploading && (text.trim().length > 0 || ready.length > 0);

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      // Chat goes over the socket, not REST. The clientMessageId makes a retry (including the store's
      // automatic one after a reconnect) post the message once.
      const message = await ticketSocketStore.request<ServiceMessage>("service.message.send", {
        requestId: request.id,
        clientMessageId: clientMessageId.current,
        body: text.trim() || undefined,
        attachments: ready.map((f) => ({ objectKey: f.objectKey!, fileName: f.name })),
      });
      onSent(message);
      setText("");
      setFiles([]);
      clientMessageId.current = randomId();
      stickToBottom.current = true;
    } catch (err) {
      if (err instanceof TicketSocketError && err.code === "ATTACHMENT_INVALID") {
        // The server rejected the whole message and deleted the bad upload(s) without saying which,
        // so every file still listed would keep failing the same way — start the attachments over.
        setFiles([]);
        toast.error(`${err.message}. Please attach your files again.`);
        return;
      }
      toast.error(err instanceof TicketSocketError || err instanceof ApiError ? err.message : "Couldn't send the message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const assignedToOther = !request.canReply && !closed;
  const firstName = request.user.name.split(" ")[0] ?? "the member";
  const canQuote = request.canReply && (request.status === "requested" || request.status === "quote_sent");

  return (
    <section className="flex min-w-0 flex-col rounded-3xl bg-white shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-divider px-7 py-5">
        <div>
          <h2 className="font-display text-xl font-bold text-primary">Conversation</h2>
          <p className="mt-1 text-xs text-muted">
            {updates}
            {hasOlder ? "+" : ""} update{updates === 1 && !hasOlder ? "" : "s"} · {lastMessage ? `Last message ${timeAgo(lastMessage.createdAt, now)}` : "No messages yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="max-w-48 truncate rounded-full bg-background px-3 py-1 text-[11px] font-bold text-primary">{request.service.title}</span>
          <RequestStatusBadge status={request.status} closedReason={request.closedReason} />
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="flex max-h-[calc(100vh-28rem)] min-h-80 flex-col gap-5 overflow-y-auto px-7 py-6">
        {historyError && (
          <button onClick={onRetryHistory} className="mx-auto rounded-full border border-red-300 px-4 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50">
            Couldn&apos;t load messages — tap to retry
          </button>
        )}
        {hasOlder && (
          <button
            onClick={loadOlder}
            disabled={loadingOlder}
            className="mx-auto flex items-center gap-2 rounded-full border border-[#dcd9d0] px-4 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-primary disabled:opacity-50"
          >
            {loadingOlder && <Loader2 size={12} className="animate-spin" />}
            Load earlier messages
          </button>
        )}

        {/* What the member asked for is the first message of the conversation. */}
        <MessageRow
          requestId={request.id}
          name={request.user.name}
          isNew={isAwaiting(request.createdAt) && messages.length === 0}
          message={{ senderRole: "user", createdAt: request.createdAt, body: request.needs, attachments: request.attachments, quote: null }}
        />

        {thread.map((item) =>
          item.kind === "event" ? (
            <p key={`e-${item.event.id}`} title={formatTicketTime(item.at)} className="mx-auto rounded-full bg-[#f1efe6] px-4 py-1 text-center text-[11px] font-semibold text-muted">
              {item.text}
            </p>
          ) : item.message.senderRole === "system" ? (
            <p key={item.message.id} title={formatTicketTime(item.at)} className="mx-auto max-w-[80%] rounded-2xl bg-[#eaf6e9] px-4 py-1.5 text-center text-[11px] font-semibold text-[#1f7a43]">
              {item.message.body}
            </p>
          ) : (
            <MessageRow
              key={item.message.id}
              requestId={request.id}
              name={item.message.senderName}
              message={item.message}
              isNew={item.message.senderRole === "user" && isAwaiting(item.message.createdAt)}
            />
          ),
        )}
      </div>

      {closed ? (
        <div className="border-t border-divider px-7 py-4 text-center text-xs font-semibold text-muted">This request is closed and the chat is locked.</div>
      ) : assignedToOther ? (
        <div className="border-t border-divider px-7 py-4 text-center text-xs font-semibold text-muted">
          Handled by {request.assignedAdmin?.name ?? "another admin"} — only they or a super admin can reply.
        </div>
      ) : (
        <div className="border-t border-divider px-7 py-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-primary">Reply to member</h3>
            {canQuote && (
              <button
                onClick={onSendQuote}
                className="flex h-9 items-center gap-2 rounded-full border border-primary px-4 text-xs font-bold text-primary transition-colors hover:bg-primary/5"
              >
                <FileText size={13} /> {request.status === "quote_sent" ? "Send a revised quote" : "Send quote"}
              </button>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            maxLength={2000}
            rows={4}
            placeholder={`Write a message to ${firstName}…`}
            className="mt-3 w-full resize-none rounded-xl border border-[#dcd9d0] bg-white px-4 py-3 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
          />

          {files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {files.map((f) => (
                <span
                  key={f.localId}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${f.status === "error" ? "border-red-300 text-red-500" : "border-[#dcd9d0] text-primary"}`}
                >
                  {f.status === "uploading" ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                  <span className="max-w-40 truncate">{f.name}</span>
                  <span className="text-muted">{formatBytes(f.size)}</span>
                  <button onClick={() => setFiles((prev) => prev.filter((p) => p.localId !== f.localId))} aria-label={`Remove ${f.name}`} className="text-muted hover:text-primary">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <input ref={fileRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={files.length >= MAX_ATTACHMENTS}
                className="flex items-center gap-1.5 rounded-full bg-background px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-divider disabled:opacity-40"
              >
                <Paperclip size={13} /> Attach file
              </button>
              <span className="text-[11px] text-muted">{!request.assignedAdmin ? "Replying assigns this request to you · " : ""}Ctrl+Enter to send</span>
            </div>
            <button
              onClick={send}
              disabled={!canSend}
              className="flex h-10 min-w-32 items-center justify-center gap-2 rounded-full bg-linear-to-r from-lime to-accent px-6 text-sm font-bold text-primary shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            >
              {sending && <Loader2 size={14} className="animate-spin" />}
              Send
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
