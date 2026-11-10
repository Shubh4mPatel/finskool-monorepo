"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2, Printer, X } from "lucide-react";
import { useEscape } from "@/components/admin/posts/useEscape";

/** The last part of the URL's path as a file name ("FS-2026-27-0006.pdf"), or `fallback` if there is none. */
function fileNameOf(url: string, fallback: string): string {
  try {
    const last = decodeURIComponent(new URL(url, window.location.href).pathname.split("/").pop() ?? "");
    return last ? (/\.pdf$/i.test(last) ? last : `${last}.pdf`) : fallback;
  } catch {
    return fallback;
  }
}

const headerBtn =
  "inline-flex items-center gap-1.5 rounded-full border border-divider px-3.5 py-2 text-xs font-bold text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";

/**
 * A PDF (an invoice or receipt) shown inside the admin app, under the Finskool header, instead of in a separate tab.
 * Print, Download and Open in new tab sit in the header; the browser's own PDF toolbar (zoom, pages) is in the frame.
 *
 * The file is fetched into a same-origin blob first, so Print and Download work whatever host the PDF is stored on.
 * If that fetch is refused (a storage host without CORS), the original address is framed instead and Print is hidden.
 */
export default function PdfViewerModal({
  title,
  url,
  fileName,
  onClose,
}: {
  title: string;
  /** The (usually time-limited) address of the PDF. */
  url: string;
  /** Name for the downloaded file; taken from the address when not given. */
  fileName?: string;
  onClose: () => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "direct">("loading");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEscape(true, onClose);

  useEffect(() => {
    const controller = new AbortController();
    let created: string | null = null;
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        // Storage often labels a PDF application/octet-stream, which a frame would offer to download rather than show.
        created = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        setBlobUrl(created);
        setState("ready");
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") setState("direct");
      });
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);

  // The page behind stays put while the viewer is open, and the close button takes the keyboard focus.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const name = fileName ?? fileNameOf(url, `${title}.pdf`);
  const src = blobUrl ?? (state === "direct" ? url : null);

  function download() {
    const a = document.createElement("a");
    a.href = blobUrl ?? url;
    a.download = name;
    a.rel = "noopener";
    if (!blobUrl) a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function print() {
    try {
      frameRef.current?.contentWindow?.focus();
      frameRef.current?.contentWindow?.print();
    } catch {
      window.open(blobUrl ?? url, "_blank", "noopener");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="animate-fade absolute inset-0 bg-primary/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-rise relative flex h-full max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-card-hover"
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-divider bg-white px-4 py-3 sm:px-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Finskool" className="h-10 w-10 shrink-0 rounded-full border border-divider" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-accent">Finskool</p>
            <h2 className="truncate font-display text-base font-bold text-primary">{title}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {state === "ready" && (
              <button type="button" onClick={print} className={headerBtn}>
                <Printer size={14} /> Print
              </button>
            )}
            <button type="button" onClick={download} disabled={state === "loading"} className={headerBtn}>
              <Download size={14} /> Download
            </button>
            <button
              type="button"
              onClick={() => window.open(blobUrl ?? url, "_blank", "noopener")}
              disabled={state === "loading"}
              className={headerBtn}
            >
              <ExternalLink size={14} /> Open in new tab
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-primary"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="relative flex-1 bg-divider/30">
          {src ? (
            <iframe ref={frameRef} src={src} title={title} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted" role="status">
              <Loader2 size={16} className="animate-spin" /> Opening {title}…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
