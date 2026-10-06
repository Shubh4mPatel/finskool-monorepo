"use client";

import { useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { MAX_YOUTUBE_URLS, type KitVideo } from "@/lib/welcome-kit";
import { useDragReorder } from "./useDragReorder";

interface LinkPreview {
  kind: "youtube" | "instagram";
  canonicalUrl: string;
  thumbnailUrl: string | null;
  title: string | null;
}

/**
 * Add/remove/reorder YouTube links. Title and thumbnail are looked up for display only — just the
 * URLs are saved, in this order.
 */
export default function YoutubeLinkList({ videos, onChange }: { videos: KitVideo[]; onChange: (v: KitVideo[]) => void }) {
  const toast = useToast();
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const drag = useDragReorder(videos, (v) => v.url, onChange);
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
      <div className="flex items-center gap-3">
        <div className="flex h-[46px] flex-1 items-center rounded-xl bg-[#f3f3f3] px-4">
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
            <button
              type="button"
              onClick={() => setLink("")}
              aria-label="Clear"
              className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-muted shadow hover:text-primary"
            >
              <X size={10} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void add()}
          disabled={!link.trim() || adding || full}
          aria-label="Add video"
          className="flex h-[46px] w-14 shrink-0 items-center justify-center rounded-xl text-white shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #22c58b, #0b8f86)" }}
        >
          {adding ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Plus size={20} />}
        </button>
      </div>

      {videos.map((v, index) => (
        <div
          key={v.url}
          {...drag.rowProps(v.url, index)}
          className={`flex items-center gap-2 transition-opacity ${drag.dragKey === v.url ? "opacity-40" : ""}`}
        >
          <button
            type="button"
            {...drag.handleProps(v.url, index)}
            className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-subtle hover:text-primary active:cursor-grabbing"
          >
            <GripVertical size={13} />
          </button>
          <div className="flex flex-1 items-center gap-4 rounded-xl bg-[#f3f3f3] px-3 py-2.5">
            {v.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={v.thumbnailUrl} alt="" className="h-[52px] w-[92px] shrink-0 rounded-sm object-cover" />
            ) : (
              <div className="h-[52px] w-[92px] shrink-0 rounded-sm bg-primary/80" />
            )}
            <p className="line-clamp-3 w-44 text-xs leading-snug text-primary">{v.title ?? v.url}</p>
            <button
              type="button"
              onClick={() => onChange(videos.filter((x) => x.url !== v.url))}
              aria-label="Remove video"
              className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-muted shadow hover:text-primary"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
