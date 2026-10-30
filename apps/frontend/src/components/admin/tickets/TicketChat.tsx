"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, Loader2, Lock, MessagesSquare } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { ticketSocketStore, TicketSocketError } from "@/store/tickets/ticketSocketStore";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  TYPE_LABEL,
  formatChatTime,
  formatTicketTime,
  randomId,
  timeAgo,
  type AdminTicketDetail,
  type AdminTicketEvent,
  type TicketAttachment,
  type TicketMessage,
} from "@/lib/tickets";
import { Avatar, StatusBadge } from "@/components/admin/tickets/TicketBadges";
import { TintAvatar } from "@/components/admin/dashboard/TintAvatar";
import { ChatComposer, ChatLockedBar, ChatNotice, DayDivider, JumpToLatest, dayKey, dayLabel } from "@/components/admin/chat/ChatParts";
import { AttachmentCard, AttachmentViewerProvider } from "@/components/admin/attachments/AttachmentViewer";

const BASE = "/api/v1/admin/tickets";

function eventText(e: AdminTicketEvent): string {
  switch (e.type) {
    case "assigned":
      return e.targetName && e.targetName !== e.actorName
        ? `Assigned to ${e.targetName} by ${e.actorName} · Status changed to In progress`
        : `${e.actorName} took the ticket · Status changed to In progress`;
    case "reassigned":
      return `Reassigned to ${e.targetName ?? "another admin"} by ${e.actorName}`;
    case "resolved":
      return `Marked as resolved by ${e.actorName}`;
    default:
      return `Ticket created by ${e.actorName}`;
  }
}

function MessageRow({
  role,
  name,
  at,
  body,
  attachments,
  isNew,
}: {
  role: "user" | "admin";
  name: string;
  at: string;
  body: string | null;
  attachments: TicketAttachment[];
  isNew: boolean;
}) {
  const admin = role === "admin";
  const content = (
    <>
      {body && <p className="whitespace-pre-wrap wrap-break-word">{body}</p>}
      {attachments.map((a) => (
        <AttachmentCard key={a.id} attachment={a} />
      ))}
    </>
  );

  if (admin) {
    return (
      <div className="animate-fade flex items-start justify-end gap-3">
        <div className="flex min-w-0 max-w-[80%] flex-col items-end">
          <p className="flex items-center gap-2 text-xs">
            <span className="font-bold text-primary">{name}</span>
            <span className="text-muted">Admin · {formatChatTime(at)}</span>
          </p>
          <div className="mt-1.5 flex flex-col items-end gap-3 rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-sm text-white shadow-[0_8px_20px_-14px_rgba(21,61,58,0.9)]">
            {content}
          </div>
        </div>
        <Avatar name={name} dark className="h-9 w-9" />
      </div>
    );
  }

  return (
    <div className="animate-fade flex items-start gap-3">
      <TintAvatar name={name} className="h-9 w-9" />
      <div className="min-w-0 max-w-[80%]">
        <p className="flex items-center gap-2 text-xs">
          <span className="font-bold text-primary">{name}</span>
          <span className="text-muted">Member · {formatChatTime(at)}</span>
          {isNew && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> New
            </span>
          )}
        </p>
        <div className="mt-1.5 flex flex-col items-start gap-3 rounded-2xl rounded-tl-md bg-background px-4 py-3 text-sm text-primary ring-1 ring-divider/70">
          {content}
        </div>
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
  | { kind: "message"; at: string; message: TicketMessage }
  | { kind: "event"; at: string; event: AdminTicketEvent };

interface Props {
  ticket: AdminTicketDetail;
  messages: TicketMessage[]; // oldest -> newest
  events: AdminTicketEvent[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  historyError: boolean;
  onRetryHistory: () => void;
  onSent: (message: TicketMessage) => void;
  now: number;
}

export default function TicketChat({ ticket, messages, events, hasOlder, loadingOlder, onLoadOlder, historyError, onRetryHistory, onSent, now }: Props) {
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevScrollHeight = useRef<number | null>(null);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  // True once the admin has scrolled up — shows the "Latest messages" button.
  const [away, setAway] = useState(false);
  // One key per logical message: reused on retry so a request that actually succeeded
  // server-side (but whose response was lost) is deduped instead of posted twice.
  const clientMessageId = useRef<string>(randomId());

  // Messages interleaved with the assignment / resolve events. Same-instant ties put the event
  // first (a claim and the reply that caused it share a transaction timestamp).
  const thread = useMemo<ThreadItem[]>(() => {
    const items: ThreadItem[] = [
      ...messages.map((message) => ({ kind: "message" as const, at: message.createdAt, message })),
      ...events.filter((e) => e.type !== "created").map((event) => ({ kind: "event" as const, at: event.createdAt, event })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1));
  }, [messages, events]);

  // Every attachment in the conversation, in display order, so the viewer can step through them.
  const allAttachments = useMemo(() => [...ticket.attachments, ...messages.flatMap((m) => m.attachments)], [ticket.attachments, messages]);
  const ticketId = ticket.id;
  const getFreshUrl = useCallback(
    async (a: TicketAttachment) => (await api.get<{ url: string }>(`${BASE}/${ticketId}/attachments/${a.id}/url`)).url,
    [ticketId],
  );

  const resolved = ticket.status === "resolved";
  // "New" = member messages nobody on the support side has answered yet.
  const lastAdminAt = useMemo(() => messages.filter((m) => m.senderRole === "admin").at(-1)?.createdAt ?? null, [messages]);
  const isAwaiting = (at: string) => !resolved && (lastAdminAt === null || at > lastAdminAt);

  const updates = thread.length;
  const lastMessage = messages.at(-1);

  // Keep the view pinned to the newest message unless the admin scrolled up; when older
  // messages are prepended, hold the viewport where it was.
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
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = atBottom;
    setAway(!atBottom);
  }

  function scrollToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function loadOlder() {
    prevScrollHeight.current = scrollRef.current?.scrollHeight ?? null;
    onLoadOlder();
  }

  async function addFiles(picked: File[]) {
    if (picked.length === 0) return;
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
        const { uploadUrl, objectKey } = await api.post<{ uploadUrl: string; objectKey: string }>(
          `${BASE}/attachments/presign`,
          { fileName: file.name, sizeBytes: file.size },
        );
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
      const message = await ticketSocketStore.request<TicketMessage>("message.send", {
        ticketId: ticket.id,
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

  const assignedToOther = !ticket.canReply && !resolved;
  const firstName = ticket.user.name.split(" ")[0] ?? "the member";

  // The thread with a divider wherever the calendar day changes.
  const rows: ReactNode[] = [];
  let prevDay = "";
  const pushDay = (at: string) => {
    const key = dayKey(at);
    if (key === prevDay) return;
    prevDay = key;
    rows.push(<DayDivider key={`d-${key}`} label={dayLabel(at, now)} />);
  };
  pushDay(ticket.createdAt);
  // The original request is the first message of the conversation.
  rows.push(
    <MessageRow
      key="original"
      role="user"
      name={ticket.user.name}
      at={ticket.createdAt}
      body={ticket.description}
      attachments={ticket.attachments}
      isNew={isAwaiting(ticket.createdAt) && messages.length === 0}
    />,
  );
  for (const item of thread) {
    pushDay(item.at);
    rows.push(
      item.kind === "event" ? (
        <ChatNotice key={`e-${item.event.id}`} title={formatTicketTime(item.at)} tone={item.event.type === "resolved" ? "success" : "neutral"}>
          {eventText(item.event)}
        </ChatNotice>
      ) : (
        <MessageRow
          key={item.message.id}
          role={item.message.senderRole}
          name={item.message.senderName}
          at={item.message.createdAt}
          body={item.message.body}
          attachments={item.message.attachments}
          isNew={item.message.senderRole === "user" && isAwaiting(item.message.createdAt)}
        />
      ),
    );
  }

  return (
    <AttachmentViewerProvider attachments={allAttachments} getFreshUrl={getFreshUrl}>
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-primary/[0.04]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <MessagesSquare size={18} />
          </span>
          <div>
            <h2 className="font-display text-[15px] font-bold tracking-tight text-primary">Conversation</h2>
            <p className="text-xs text-muted">
              {updates}
              {hasOlder ? "+" : ""} update{updates === 1 && !hasOlder ? "" : "s"} ·{" "}
              {lastMessage ? `Last reply ${timeAgo(lastMessage.createdAt, now)}` : "No replies yet"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-background px-3 py-1 text-[11px] font-bold text-primary">{TYPE_LABEL[ticket.type]}</span>
          <StatusBadge status={ticket.status} />
        </div>
      </header>

      <div className="relative">
        <div ref={scrollRef} onScroll={handleScroll} className="scrollbar-slim flex max-h-[calc(100vh-28rem)] min-h-80 flex-col gap-5 overflow-y-auto px-6 py-6">
          {historyError && (
            <button
              onClick={onRetryHistory}
              className="mx-auto rounded-full border border-red-300 bg-red-50 px-4 py-1.5 text-xs font-semibold text-red-500 transition-colors hover:bg-red-100"
            >
              Couldn&apos;t load messages — tap to retry
            </button>
          )}
          {hasOlder && (
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="mx-auto flex items-center gap-2 rounded-full border border-divider bg-white px-4 py-1.5 text-xs font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-50"
            >
              {loadingOlder && <Loader2 size={12} className="animate-spin" />}
              Load earlier messages
            </button>
          )}
          {rows}
        </div>
        {away && <JumpToLatest onClick={scrollToLatest} />}
      </div>

      {resolved ? (
        <ChatLockedBar icon={<CheckCircle2 size={14} />}>This ticket is resolved and the chat is closed.</ChatLockedBar>
      ) : assignedToOther ? (
        <ChatLockedBar icon={<Lock size={14} />}>
          Handled by {ticket.assignedAdmin?.name ?? "another admin"} — only they or a super admin can reply.
        </ChatLockedBar>
      ) : (
        <ChatComposer
          title="Reply to member"
          value={text}
          onChange={setText}
          placeholder={`Write a reply to ${firstName}…`}
          onSend={send}
          canSend={canSend}
          sending={sending}
          sendLabel="Send reply"
          files={files}
          onRemoveFile={(id) => setFiles((prev) => prev.filter((p) => p.localId !== id))}
          onPickFiles={addFiles}
          maxFiles={MAX_ATTACHMENTS}
          hint={`${!ticket.assignedAdmin ? "Replying assigns this ticket to you · " : ""}Ctrl+Enter to send`}
        />
      )}
    </section>
    </AttachmentViewerProvider>
  );
}
