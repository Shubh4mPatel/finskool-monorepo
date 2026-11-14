"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
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

// A4 portrait. The invoice is one page, so the frame is cut to the page's own shape and it reads as a picture.
const PAGE_RATIO = 210 / 297;
// The viewer's own bars (header and padding), taken off the screen height to get the room the page has.
const ROOM = "calc(100vh - 7rem)";
// Hides the browser PDF viewer's toolbar, side panel and scrollbar, and fits the whole page in the frame.
const VIEWER_PARAMS = "#toolbar=0&navpanes=0&scrollbar=0&view=Fit";
const ZOOM = 1.7;

const iconBtn = "flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-40";

/**
 * A PDF (an invoice or receipt) opened the way a photo opens in a chat app: a dark full-screen view with the page in the
 * middle, and only Zoom, Download and Close above it. Click the dark area, press Esc or the X to leave; click the page to
 * zoom in and out.
 *
 * The file is fetched into a same-origin blob first, so Download works whatever host the PDF is stored on and the file
 * keeps its own name. If that fetch is refused (a storage host without CORS), the original address is framed instead.
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
  const [zoomed, setZoomed] = useState(false);
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

  // The page behind stays put while the viewer is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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

  const pageHeight = zoomed ? `calc(${ROOM} * ${ZOOM})` : ROOM;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="animate-fade fixed inset-0 z-100 flex flex-col bg-[#0b1412]/95 backdrop-blur-sm">
      <header className="flex items-center gap-3 px-4 py-3 text-white sm:px-6">
        <div className="flex shrink-0 items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Finskool" className="h-8 w-8 rounded-lg" />
          <span className="hidden font-display text-base font-bold sm:inline">Finskool</span>
        </div>
        <span className="mx-1 hidden h-6 w-px bg-white/20 sm:block" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="text-[11px] text-white/60">PDF</p>
        </div>
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          disabled={!src}
          aria-label={zoomed ? "Fit to screen" : "Zoom in"}
          title={zoomed ? "Fit to screen" : "Zoom in"}
          className={iconBtn}
        >
          {zoomed ? <ZoomOut size={19} /> : <ZoomIn size={19} />}
        </button>
        <button type="button" onClick={download} disabled={state === "loading"} aria-label="Download" title="Download" className={iconBtn}>
          <Download size={19} />
        </button>
        <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" autoFocus className={iconBtn}>
          <X size={21} />
        </button>
      </header>

      {/* Clicking the dark area around the page closes the viewer, like a lightbox. */}
      <div
        className={`relative flex min-h-0 flex-1 px-4 pb-6 sm:px-16 ${zoomed ? "items-start justify-center overflow-auto" : "items-center justify-center"}`}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {src ? (
          <div
            className="relative shrink-0 overflow-hidden rounded-lg bg-white shadow-2xl"
            style={{ height: pageHeight, aspectRatio: PAGE_RATIO, maxWidth: zoomed ? undefined : "100%" }}
          >
            <iframe src={`${src}${VIEWER_PARAMS}`} title={title} className="h-full w-full border-0" />
            {/* The frame would swallow clicks, so a clear layer over it lets a click on the page zoom, as an image does. */}
            <button
              type="button"
              onClick={() => setZoomed((z) => !z)}
              aria-label={zoomed ? "Fit to screen" : "Zoom in"}
              className={`absolute inset-0 ${zoomed ? "cursor-zoom-out" : "cursor-zoom-in"}`}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-white/70" role="status">
            <Loader2 size={18} className="animate-spin" /> Opening {title}…
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
