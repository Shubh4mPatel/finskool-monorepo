"use client";

import { useState } from "react";
import { Play, Plus, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { MAX_YOUTUBE_URLS, type KitVideo } from "@/lib/welcome-kit";

interface LinkPreview {
  kind: "youtube" | "instagram";
  canonicalUrl: string;
  thumbnailUrl: string | null;
  title: string | null;
}

/** Add/remove YouTube links. Title and thumbnail are looked up for display only — just the URL is saved. */
export default function YoutubeLinkList({ videos, onChange }: { videos: KitVideo[]; onChange: (v: KitVideo[]) => void }) {
  const toast = useToast();
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const full = videos.length >= MAX_YOUTUBE_URLS;

  async function add() {
    const url = link.trim();
    if (!url) return;
    if (full) return toast.error(`You can add up to ${MAX_YOUTUBE_URLS} videos.`);
    setAdding(true);
    try {
      const p = await api.post<LinkPreview>("/api/v1/posts/video-preview", { url });
      if (p.kind !== "youtube") return toast.error("Only YouTube links can be added here.");
      if (videos.some((v) => v.url === p.canonicalUrl)) return toast.error("That video is already added.");
      onChange([...videos, { url: p.canonicalUrl, title: p.title, thumbnailUrl: p.thumbnailUrl }]);
      setLink("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add that link");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-xl border border-divider bg-background px-3 py-2.5 focus-within:border-accent">
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            disabled={full}
            placeholder="https://www.youtube.com/watch?v=…"
            className="min-w-0 flex-1 bg-transparent text-sm text-primary placeholder:text-subtle focus:outline-none"
          />
          {link && (
            <button type="button" onClick={() => setLink("")} aria-label="Clear" className="flex h-5 w-5 items-center justify-center rounded-full bg-divider text-muted hover:text-primary">
              <X size={10} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void add()}
          disabled={!link.trim() || adding || full}
          aria-label="Add video"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #1fc77a, #108b8b)" }}
        >
          {adding ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Plus size={18} />}
        </button>
      </div>

      {videos.map((v) => (
        <div key={v.url} className="flex items-center gap-3 rounded-xl border border-divider bg-background p-2">
          <div className="relative h-[54px] w-[84px] shrink-0 overflow-hidden rounded-lg bg-primary/90">
            {v.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-primary shadow">
                <Play size={11} className="ml-0.5 fill-current" />
              </span>
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-primary">{v.title ?? "YouTube video"}</p>
            <p className="truncate text-[10px] text-muted">{v.url}</p>
            <p className="text-[10px] text-subtle">youtube.com</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(videos.filter((x) => x.url !== v.url))}
            aria-label="Remove video"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-divider text-muted hover:text-primary"
          >
            <X size={11} />
          </button>
        </div>
      ))}

      <p className="text-xs text-subtle">{videos.length}/{MAX_YOUTUBE_URLS} videos{full ? " — remove one to add another." : "."}</p>
    </div>
  );
}
