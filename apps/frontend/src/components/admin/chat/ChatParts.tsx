"use client";

import { useRef } from "react";
import type { ReactNode } from "react";
import { ArrowDown, Loader2, Paperclip, Send, X } from "lucide-react";
import { ATTACHMENT_ACCEPT, formatBytes } from "@/lib/tickets";

// Shared by the support-ticket chat and the service-enquiry chat — the same conversation UI,
// so a fix or a design change lands in both.

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A stable per-calendar-day key, for spotting where one day's messages end and the next day's begin. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "12 Oct" (with the year once it isn't this year). `now` is passed in so render stays pure. */
export function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  const today = new Date(now);
  const diff = Math.round((startOfDay(today) - startOfDay(d)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" as const }),
  });
}

export function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-divider" />
      <span className="rounded-full bg-background px-3 py-0.5 text-[11px] font-bold text-muted">{label}</span>
      <span className="h-px flex-1 bg-divider" />
    </div>
  );
}

/** A centred system line inside the thread ("Assigned to …", "Marked as resolved …"). */
export function ChatNotice({ children, title, tone = "neutral" }: { children: ReactNode; title?: string; tone?: "neutral" | "success" }) {
  return (
    <p
      title={title}
      className={`animate-fade mx-auto max-w-[85%] rounded-full px-4 py-1.5 text-center text-[11px] font-semibold ${
        tone === "success" ? "bg-lime/30 text-primary" : "bg-background text-muted"
      }`}
    >
      {children}
    </p>
  );
}

/** Floats over the bottom of the thread while the admin has scrolled up. */
export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="animate-fade absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-white shadow-card-hover transition-all hover:-translate-y-px hover:bg-[#1c4c48]"
    >
      <ArrowDown size={13} className="text-lime" /> Latest messages
    </button>
  );
}

/** The bar that replaces the reply box when nobody can reply (resolved / closed / handled by someone else). */
export function ChatLockedBar({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 border-t border-divider bg-background/50 px-7 py-4 text-center text-xs font-semibold text-muted">
      <span className="shrink-0 text-subtle">{icon}</span>
      {children}
    </div>
  );
}

export interface ComposerFile {
  localId: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
}

const MAX_CHARS = 2000;

/** The reply box: textarea, attachment chips, attach button and send. Sending and uploading stay with the chat. */
export function ChatComposer({
  title,
  value,
  onChange,
  placeholder,
  onSend,
  canSend,
  sending,
  sendLabel,
  files,
  onRemoveFile,
  onPickFiles,
  maxFiles,
  hint,
  extraAction,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onSend: () => void;
  canSend: boolean;
  sending: boolean;
  sendLabel: string;
  files: ComposerFile[];
  onRemoveFile: (localId: string) => void;
  /** The chosen files, copied out of the input (which is then cleared so the same file can be picked again). */
  onPickFiles: (files: File[]) => void;
  maxFiles: number;
  hint: string;
  extraAction?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border-t border-divider px-7 py-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-primary">{title}</h3>
        {extraAction}
      </div>

      <div className="mt-3 rounded-2xl border border-divider bg-white transition-all focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/10">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSend();
            }
          }}
          maxLength={MAX_CHARS}
          rows={4}
          aria-label={title}
          placeholder={placeholder}
          className="w-full resize-none rounded-2xl bg-transparent px-4 pt-3 text-sm text-primary placeholder:text-subtle focus:outline-none"
        />

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {files.map((f) => (
              <span
                key={f.localId}
                className={`animate-fade flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                  f.status === "error" ? "border-red-300 bg-red-50 text-red-500" : "border-divider bg-background text-primary"
                }`}
              >
                {f.status === "uploading" ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                <span className="max-w-40 truncate">{f.name}</span>
                <span className="text-muted">{formatBytes(f.size)}</span>
                <button type="button" onClick={() => onRemoveFile(f.localId)} aria-label={`Remove ${f.name}`} className="text-muted transition-colors hover:text-primary">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider/70 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                onPickFiles(picked);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={files.length >= maxFiles}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-background hover:text-primary disabled:opacity-40"
            >
              <Paperclip size={13} /> Attach
            </button>
            <span className="text-[11px] text-subtle">
              {hint}
              {value.length >= MAX_CHARS * 0.75 && <span className="ml-2 tabular-nums">{value.length}/{MAX_CHARS}</span>}
            </span>
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="flex h-9 min-w-28 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white shadow-[0_8px_20px_-12px_rgba(21,61,58,0.7)] transition-all hover:-translate-y-px hover:bg-[#1c4c48] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} className="text-lime" />}
            {sendLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
