"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, FileText, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { fileExtension, formatBytes, type TicketAttachment } from "@/lib/tickets";

type Kind = "image" | "video" | "pdf" | "file";

function kindOf(a: Pick<TicketAttachment, "mimeType">): Kind {
  if (a.mimeType.startsWith("image/")) return "image";
  if (a.mimeType.startsWith("video/")) return "video";
  if (a.mimeType === "application/pdf") return "pdf";
  return "file";
}

interface ViewerContextValue {
  open: (id: string) => void;
  /** Signed links last about 5 minutes, so ask for a fresh one right before showing or saving a file. */
  freshUrl: (a: TicketAttachment) => Promise<string>;
}

const ViewerContext = createContext<ViewerContextValue | null>(null);

function clickDownload(href: string, fileName: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Saves a file under its own name. The bytes are fetched first so the name is always honoured (the
 * browser ignores `download` on links to another origin); if that fails, fall back to a plain link.
 */
async function saveAs(url: string, fileName: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const objectUrl = URL.createObjectURL(await res.blob());
    clickDownload(objectUrl, fileName);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch {
    clickDownload(url, fileName);
  }
}

/**
 * Lets every attachment in a chat open in an in-page viewer (instead of a bare browser tab) and lets the
 * arrow keys move through the conversation's images, videos and PDFs.
 */
export function AttachmentViewerProvider({
  attachments,
  getFreshUrl,
  children,
}: {
  /** Every attachment in the conversation, in the order shown. */
  attachments: TicketAttachment[];
  getFreshUrl: (a: TicketAttachment) => Promise<string>;
  children: React.ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const viewable = useMemo(() => attachments.filter((a) => kindOf(a) !== "file"), [attachments]);

  const freshUrl = useCallback(
    async (a: TicketAttachment) => {
      try {
        return await getFreshUrl(a);
      } catch {
        return a.url;
      }
    },
    [getFreshUrl],
  );
  const value = useMemo<ViewerContextValue>(() => ({ open: setOpenId, freshUrl }), [freshUrl]);
  const index = openId ? viewable.findIndex((a) => a.id === openId) : -1;

  return (
    <ViewerContext.Provider value={value}>
      {children}
      {index >= 0 && (
        <Viewer items={viewable} index={index} freshUrl={freshUrl} onIndex={(i) => setOpenId(viewable[i]?.id ?? null)} onClose={() => setOpenId(null)} />
      )}
    </ViewerContext.Provider>
  );
}

function Viewer({
  items,
  index,
  freshUrl,
  onIndex,
  onClose,
}: {
  items: TicketAttachment[];
  index: number;
  freshUrl: (a: TicketAttachment) => Promise<string>;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index]!;
  const kind = kindOf(item);
  // The loaded link belongs to one item; "loading" is simply "not loaded for the current item yet".
  const [loaded, setLoaded] = useState<{ id: string; url: string; attempt: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const go = useCallback((d: number) => onIndex(index + d), [index, onIndex]);

  useEffect(() => {
    let cancelled = false;
    freshUrl(item).then((url) => {
      if (!cancelled) setLoaded({ id: item.id, url, attempt });
    });
    return () => {
      cancelled = true;
    };
  }, [item, attempt, freshUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasPrev) go(-1);
      else if (e.key === "ArrowRight" && hasNext) go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go, hasPrev, hasNext]);

  // Lock the page behind the viewer and put focus inside it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const ready = loaded && loaded.id === item.id && loaded.attempt === attempt ? loaded.url : null;
  const error = failed === `${item.id}:${attempt}`;

  async function download() {
    saveAs(await freshUrl(item), item.fileName);
  }

  function retry() {
    setFailed(null);
    setLoaded(null);
    setAttempt((n) => n + 1);
  }

  const failHere = () => setFailed(`${item.id}:${attempt}`);
  const iconBtn = "flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white";

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={item.fileName} className="fixed inset-0 z-100 flex flex-col bg-[#0b1412]/95 backdrop-blur-sm">
      <header className="flex items-center gap-3 px-4 py-3 text-white sm:px-6">
        <div className="flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Finskool" className="h-8 w-8 rounded-lg" />
          <span className="hidden font-display text-base font-bold sm:inline">Finskool</span>
        </div>
        <span className="mx-1 hidden h-6 w-px bg-white/20 sm:block" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.fileName}</p>
          <p className="text-[11px] text-white/60">
            {formatBytes(item.sizeBytes)}
            {items.length > 1 && ` · ${index + 1} of ${items.length}`}
          </p>
        </div>
        {kind === "image" && ready && !error && (
          <button type="button" onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? "Fit to screen" : "Zoom in"} className={iconBtn}>
            {zoomed ? <ZoomOut size={19} /> : <ZoomIn size={19} />}
          </button>
        )}
        <button type="button" onClick={download} aria-label="Download" title="Download" className={iconBtn}>
          <Download size={19} />
        </button>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className={iconBtn}>
          <X size={21} />
        </button>
      </header>

      {/* Clicking the dark area around the file closes the viewer, like a lightbox. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {hasPrev && (
          <button type="button" onClick={() => go(-1)} aria-label="Previous" className={`${iconBtn} absolute left-2 top-1/2 z-10 -translate-y-1/2 bg-black/40 sm:left-4`}>
            <ChevronLeft size={24} />
          </button>
        )}
        {hasNext && (
          <button type="button" onClick={() => go(1)} aria-label="Next" className={`${iconBtn} absolute right-2 top-1/2 z-10 -translate-y-1/2 bg-black/40 sm:right-4`}>
            <ChevronRight size={24} />
          </button>
        )}

        {error ? (
          <div className="flex flex-col items-center gap-3 text-center text-white">
            <FileText size={36} className="text-white/50" />
            <p className="text-sm font-semibold">Couldn&apos;t load this file</p>
            <button type="button" onClick={retry} className="rounded-full bg-white px-5 py-2 text-sm font-bold text-primary">Try again</button>
          </div>
        ) : !ready ? (
          <Loader2 className="animate-spin text-white/70" size={30} />
        ) : kind === "image" ? (
          <div className={`flex max-h-full max-w-full ${zoomed ? "overflow-auto" : "items-center justify-center"}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={ready}
              src={ready}
              alt={item.fileName}
              onError={failHere}
              onClick={() => setZoomed((z) => !z)}
              className={zoomed ? "max-w-none cursor-zoom-out" : "max-h-[calc(100vh-7rem)] max-w-full cursor-zoom-in rounded-lg object-contain shadow-2xl"}
            />
          </div>
        ) : kind === "video" ? (
          <video key={ready} src={ready} controls autoPlay playsInline onError={failHere} className="max-h-[calc(100vh-7rem)] max-w-full rounded-lg bg-black shadow-2xl" />
        ) : (
          <iframe key={ready} src={ready} title={item.fileName} className="h-full w-full max-w-4xl rounded-lg bg-white shadow-2xl" />
        )}
      </div>
    </div>,
    document.body,
  );
}

/** One attachment in a chat bubble: images show a thumbnail that opens the viewer; other files show a card. */
export function AttachmentCard({ attachment }: { attachment: TicketAttachment }) {
  const ctx = useContext(ViewerContext);
  const [url, setUrl] = useState(attachment.url);
  const [retried, setRetried] = useState(false);
  const kind = kindOf(attachment);

  async function refreshThumbnailOnce() {
    if (retried || !ctx) return;
    setRetried(true);
    setUrl(await ctx.freshUrl(attachment));
  }

  async function save() {
    if (ctx) saveAs(await ctx.freshUrl(attachment), attachment.fileName);
  }

  const caption = (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-xs font-bold">{attachment.fileName}</span>
      <span className="block text-[11px] text-muted">{formatBytes(attachment.sizeBytes)}</span>
    </span>
  );

  if (kind === "image") {
    return (
      <div className="w-fit max-w-full overflow-hidden rounded-xl bg-white text-primary shadow-sm ring-1 ring-divider">
        <button type="button" onClick={() => ctx?.open(attachment.id)} aria-label={`Open ${attachment.fileName}`} className="block cursor-zoom-in">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={attachment.fileName} onError={refreshThumbnailOnce} className="max-h-56 w-full min-w-40 bg-background object-cover" />
        </button>
        <div className="flex items-center gap-3 px-3 py-2">{caption}</div>
      </div>
    );
  }

  return (
    <div className="flex w-fit min-w-60 max-w-full items-center gap-3 rounded-xl bg-white px-3 py-2.5 text-primary shadow-sm ring-1 ring-divider">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#dff1ee] text-[10px] font-bold text-accent">{fileExtension(attachment.fileName)}</span>
      {caption}
      {kind === "file" ? (
        <button type="button" onClick={save} className="shrink-0 rounded-full px-2 py-1 text-xs font-bold text-accent transition-colors hover:bg-accent/10">Download</button>
      ) : (
        <button type="button" onClick={() => ctx?.open(attachment.id)} className="shrink-0 rounded-full px-2 py-1 text-xs font-bold text-accent transition-colors hover:bg-accent/10">{kind === "video" ? "Play" : "View"}</button>
      )}
    </div>
  );
}
