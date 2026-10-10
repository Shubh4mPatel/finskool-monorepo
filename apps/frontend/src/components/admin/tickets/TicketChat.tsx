"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  formatTicketTime,
  type AdminTicketDetail,
  type TicketAttachment,
  type TicketMessage,
} from "@/lib/tickets";

const BASE = "/api/v1/admin/tickets";

function AttachmentView({ ticketId, attachment }: { ticketId: string; attachment: TicketAttachment }) {
  const [url, setUrl] = useState(attachment.url);
  const [retried, setRetried] = useState(false);
  const isImage = attachment.mimeType.startsWith("image/");

  // Signed links last ~5 min; ask for a fresh one right before opening.
  async function open(e: React.MouseEvent) {
    e.preventDefault();
    try {
      const { url: fresh } = await api.get<{ url: string }>(`${BASE}/${ticketId}/attachments/${attachment.id}/url`);
      window.open(fresh, "_blank", "noopener,noreferrer");
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function refreshOnce() {
    if (retried) return;
    setRetried(true);
    try {
      const { url: fresh } = await api.get<{ url: string }>(`${BASE}/${ticketId}/attachments/${attachment.id}/url`);
      setUrl(fresh);
    } catch {
      // leave the broken thumbnail; the link still works
    }
  }

  return isImage ? (
    <a href={url} onClick={open} className="block overflow-hidden rounded-lg border border-divider">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={attachment.fileName} onError={refreshOnce} className="max-h-48 max-w-full object-cover" />
    </a>
  ) : (
    <a
      href={url}
      onClick={open}
      className="flex items-center gap-2 rounded-lg border border-divider bg-white px-3 py-2 text-xs font-semibold text-primary hover:border-accent"
    >
      <FileText size={16} className="shrink-0 text-accent" />
      <span className="truncate">{attachment.fileName}</span>
      <span className="shrink-0 text-muted">{formatBytes(attachment.sizeBytes)}</span>
    </a>
  );
}

function Bubble({
  ticketId,
  mine,
  name,
  body,
  attachments,
  at,
}: {
  ticketId: string;
  mine: boolean;
  name: string;
  body: string | null;
  attachments: TicketAttachment[];
  at: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`flex max-w-[78%] flex-col gap-2 rounded-2xl px-4 py-2.5 text-sm ${
          mine ? "rounded-br-sm bg-primary text-white" : "rounded-bl-sm bg-divider text-primary"
        }`}
      >
        {body && <p className="whitespace-pre-wrap wrap-break-word">{body}</p>}
        {attachments.map((a) => (
          <AttachmentView key={a.id} ticketId={ticketId} attachment={a} />
        ))}
      </div>
      <span className="px-1 text-[10px] text-subtle">
        {name} · {formatTicketTime(at)}
      </span>
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

interface Props {
  ticket: AdminTicketDetail;
  messages: TicketMessage[]; // oldest -> newest
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onSent: (message: TicketMessage) => void;
  currentUserId: string;
}

export default function TicketChat({ ticket, messages, hasOlder, loadingOlder, onLoadOlder, onSent, currentUserId }: Props) {
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
  const clientMessageId = useRef<string>(crypto.randomUUID());

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
  }, [messages]);

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
      const localId = crypto.randomUUID();
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
      clientMessageId.current = crypto.randomUUID();
      stickToBottom.current = true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't send the message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  // Textarea sizing: grow with content up to a cap.
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  const resolved = ticket.status === "resolved";
  const assignedToOther = !ticket.canReply && !resolved;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={handleScroll} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {hasOlder && (
          <button
            onClick={loadOlder}
            disabled={loadingOlder}
            className="mx-auto flex items-center gap-2 rounded-full border border-divider px-4 py-1.5 text-xs font-semibold text-muted hover:border-accent hover:text-primary disabled:opacity-50"
          >
            {loadingOlder && <Loader2 size={12} className="animate-spin" />}
            Load earlier messages
          </button>
        )}

        {/* The original request is the first bubble of the conversation. */}
        <Bubble
          ticketId={ticket.id}
          mine={false}
          name={ticket.user.name}
          body={ticket.description}
          attachments={ticket.attachments}
          at={ticket.createdAt}
        />

        {messages.map((m) => (
          <Bubble
            key={m.id}
            ticketId={ticket.id}
            mine={m.senderId === currentUserId}
            name={m.senderRole === "user" ? m.senderName : `${m.senderName} (Support)`}
            body={m.body}
            attachments={m.attachments}
            at={m.createdAt}
          />
        ))}

        {resolved && (
          <p className="mx-auto rounded-full bg-[#4caf50]/10 px-4 py-1 text-xs font-semibold text-[#2e7d32]">
            Resolved{ticket.resolvedAt ? ` · ${formatTicketTime(ticket.resolvedAt)}` : ""}
          </p>
        )}
      </div>

      {resolved ? (
        <div className="border-t border-divider px-5 py-3 text-center text-xs font-semibold text-muted">
          This ticket is resolved and the chat is closed.
        </div>
      ) : assignedToOther ? (
        <div className="border-t border-divider px-5 py-3 text-center text-xs font-semibold text-muted">
          Handled by {ticket.assignedAdmin?.name ?? "another admin"} — only they or a super admin can reply.
        </div>
      ) : (
        <div className="border-t border-divider px-4 py-3">
          {!ticket.assignedAdmin && (
            <p className="mb-2 px-1 text-[11px] font-semibold text-accent">Replying will assign this ticket to you.</p>
          )}
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((f) => (
                <span
                  key={f.localId}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                    f.status === "error" ? "border-red-300 text-red-500" : "border-divider text-primary"
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
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={files.length >= MAX_ATTACHMENTS}
              aria-label="Attach files"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-divider text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-40"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              maxLength={2000}
              rows={1}
              placeholder="Write a reply…  (Enter to send, Shift+Enter for a new line)"
              className="max-h-35 min-h-10 flex-1 resize-none rounded-2xl border border-divider bg-white px-4 py-2.5 text-sm text-primary outline-none transition-colors placeholder:text-subtle focus:border-accent"
            />
            <button
              onClick={send}
              disabled={!canSend}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
