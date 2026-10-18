"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  TYPE_LABEL,
  fileExtension,
  formatBytes,
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

function AttachmentCard({ ticketId, attachment }: { ticketId: string; attachment: TicketAttachment }) {
  const [url, setUrl] = useState(attachment.url);
  const [retried, setRetried] = useState(false);
  const isImage = attachment.mimeType.startsWith("image/");

  async function fresh(): Promise<string | null> {
    try {
      return (await api.get<{ url: string }>(`${BASE}/${ticketId}/attachments/${attachment.id}/url`)).url;
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
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#dff1ee] text-[10px] font-bold text-accent">
          {fileExtension(attachment.fileName)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold">{attachment.fileName}</span>
        <span className="block text-[11px] text-muted">{formatBytes(attachment.sizeBytes)}</span>
      </span>
      <button onClick={view} className="shrink-0 text-xs font-bold text-accent hover:underline">
        View
      </button>
    </div>
  );
}

function MessageRow({
  ticketId,
  role,
  name,
  at,
  body,
  attachments,
  isNew,
}: {
  ticketId: string;
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
        <AttachmentCard key={a.id} ticketId={ticketId} attachment={a} />
      ))}
    </>
  );

  if (admin) {
    return (
      <div className="flex items-start justify-end gap-3">
        <div className="flex min-w-0 max-w-[80%] flex-col items-end">
          <p className="flex items-center gap-2 text-xs">
            <span className="font-bold text-primary">{name}</span>
            <span className="text-muted">Admin · {formatChatTime(at)}</span>
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
          <span className="text-muted">Member · {formatChatTime(at)}</span>
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
  | { kind: "message"; at: string; message: TicketMessage }
  | { kind: "event"; at: string; event: AdminTicketEvent };

interface Props {
  ticket: AdminTicketDetail;
  messages: TicketMessage[]; // oldest -> newest
  events: AdminTicketEvent[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onSent: (message: TicketMessage) => void;
  now: number;
}

export default function TicketChat({ ticket, messages, events, hasOlder, loadingOlder, onLoadOlder, onSent, now }: Props) {
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const prevScrollHeight = useRef<number | null>(null);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
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
      const message = await api.post<TicketMessage>(`${BASE}/${ticket.id}/messages`, {
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
      toast.error(err instanceof ApiError ? err.message : "Couldn't send the message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const assignedToOther = !ticket.canReply && !resolved;
  const firstName = ticket.user.name.split(" ")[0] ?? "the member";

  return (
    <section className="flex min-w-0 flex-col rounded-3xl bg-white shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-divider px-7 py-5">
        <div>
          <h2 className="font-display text-xl font-bold text-primary">Conversation</h2>
          <p className="mt-1 text-xs text-muted">
            {updates}
            {hasOlder ? "+" : ""} update{updates === 1 && !hasOlder ? "" : "s"} ·{" "}
            {lastMessage ? `Last reply ${timeAgo(lastMessage.createdAt, now)}` : "No replies yet"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-background px-3 py-1 text-[11px] font-bold text-primary">{TYPE_LABEL[ticket.type]}</span>
          <StatusBadge status={ticket.status} />
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="flex max-h-[calc(100vh-28rem)] min-h-80 flex-col gap-5 overflow-y-auto px-7 py-6">
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

        {/* The original request is the first message of the conversation. */}
        <MessageRow
          ticketId={ticket.id}
          role="user"
          name={ticket.user.name}
          at={ticket.createdAt}
          body={ticket.description}
          attachments={ticket.attachments}
          isNew={isAwaiting(ticket.createdAt) && messages.length === 0}
        />

        {thread.map((item) =>
          item.kind === "event" ? (
            <p
              key={`e-${item.event.id}`}
              title={formatTicketTime(item.at)}
              className="mx-auto rounded-full bg-[#f1efe6] px-4 py-1 text-center text-[11px] font-semibold text-muted"
            >
              {eventText(item.event)}
            </p>
          ) : (
            <MessageRow
              key={item.message.id}
              ticketId={ticket.id}
              role={item.message.senderRole}
              name={item.message.senderName}
              at={item.message.createdAt}
              body={item.message.body}
              attachments={item.message.attachments}
              isNew={item.message.senderRole === "user" && isAwaiting(item.message.createdAt)}
            />
          ),
        )}
      </div>

      {resolved ? (
        <div className="border-t border-divider px-7 py-4 text-center text-xs font-semibold text-muted">
          This ticket is resolved and the chat is closed.
        </div>
      ) : assignedToOther ? (
        <div className="border-t border-divider px-7 py-4 text-center text-xs font-semibold text-muted">
          Handled by {ticket.assignedAdmin?.name ?? "another admin"} — only they or a super admin can reply.
        </div>
      ) : (
        <div className="border-t border-divider px-7 py-5">
          <h3 className="text-sm font-bold text-primary">Reply to member</h3>
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
            placeholder={`Write a reply to ${firstName}…`}
            className="mt-3 w-full resize-none rounded-xl border border-[#dcd9d0] bg-white px-4 py-3 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-accent"
          />

          {files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {files.map((f) => (
                <span
                  key={f.localId}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                    f.status === "error" ? "border-red-300 text-red-500" : "border-[#dcd9d0] text-primary"
                  }`}
                >
                  {f.status === "uploading" ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                  <span className="max-w-40 truncate">{f.name}</span>
                  <span className="text-muted">{formatBytes(f.size)}</span>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((p) => p.localId !== f.localId))}
                    aria-label={`Remove ${f.name}`}
                    className="text-muted hover:text-primary"
                  >
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
              <span className="text-[11px] text-muted">
                {!ticket.assignedAdmin ? "Replying assigns this ticket to you · " : ""}Ctrl+Enter to send
              </span>
            </div>
            <button
              onClick={send}
              disabled={!canSend}
              className="flex h-10 min-w-32 items-center justify-center gap-2 rounded-full bg-linear-to-r from-lime to-accent px-6 text-sm font-bold text-primary shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            >
              {sending && <Loader2 size={14} className="animate-spin" />}
              Send reply
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
