"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon, Play, Plus, UploadCloud, Video, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import PostImageUploader from "@/components/admin/PostImageUploader";
import {
  MAX_POST_VIDEOS,
  MAX_VIDEO_MB,
  VIDEO_TYPES_BY_EXT,
  type PostVideo,
  type PostVideoKind,
} from "@/lib/post-videos";

type Tab = "media" | "video";
type IconProps = { size?: number; className?: string };

// lucide-react no longer ships brand icons.
function Youtube({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z" />
    </svg>
  );
}

function Instagram({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" />
    </svg>
  );
}
type VideoSource = PostVideoKind;

interface LinkPreview {
  kind: "youtube" | "instagram";
  externalId: string;
  canonicalUrl: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  title: string | null;
}

const SOURCES: { id: VideoSource; label: string; icon: React.ComponentType<IconProps> }[] = [
  { id: "file", label: "Upload file", icon: UploadCloud },
  { id: "youtube", label: "YouTube link", icon: Youtube },
  { id: "instagram", label: "Instagram link", icon: Instagram },
];

const PLACEHOLDERS: Record<"youtube" | "instagram", string> = {
  youtube: "https://www.youtube.com/watch?v=…",
  instagram: "https://www.instagram.com/reel/…",
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// XHR rather than fetch so the upload can report progress — videos are big.
function putWithProgress(url: string, file: File, contentType: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

function VideoThumb({ video }: { video: PostVideo }) {
  return (
    <div className="relative h-[54px] w-[84px] shrink-0 overflow-hidden rounded-lg bg-primary/90">
      {video.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
      ) : video.kind === "file" ? (
        <video src={`${video.url}#t=0.1`} preload="metadata" muted className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white">
          <Instagram size={20} />
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-primary shadow">
          <Play size={11} className="ml-0.5 fill-current" />
        </span>
      </span>
    </div>
  );
}

function VideoEditor({ videos, onChange }: { videos: PostVideo[]; onChange: (v: PostVideo[]) => void }) {
  const toast = useToast();
  const [source, setSource] = useState<VideoSource>("youtube");
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = videos.length >= MAX_POST_VIDEOS;

  async function addLink() {
    const url = link.trim();
    if (!url || (source !== "youtube" && source !== "instagram")) return;
    if (full) return toast.error(`You can add up to ${MAX_POST_VIDEOS} videos per post.`);
    setAdding(true);
    try {
      const p = await api.post<LinkPreview>("/api/v1/posts/video-preview", { url });
      if (p.kind !== source) {
        toast.error(source === "youtube" ? "That isn't a YouTube link." : "That isn't an Instagram link.");
        return;
      }
      if (videos.some((v) => v.kind === p.kind && v.externalId === p.externalId)) {
        toast.error("That video is already added.");
        return;
      }
      onChange([
        ...videos,
        { kind: p.kind, url: p.canonicalUrl, embedUrl: p.embedUrl, externalId: p.externalId, title: p.title, thumbnailUrl: p.thumbnailUrl },
      ]);
      setLink("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not add that link");
    } finally {
      setAdding(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    if (full) return toast.error(`You can add up to ${MAX_POST_VIDEOS} videos per post.`);

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const contentType = VIDEO_TYPES_BY_EXT[ext];
    if (!contentType) return toast.error("Only MP4 and MOV videos can be uploaded.");
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) return toast.error(`Videos can be at most ${MAX_VIDEO_MB} MB.`);

    setUploadPct(0);
    try {
      const { uploadUrl, publicUrl } = await api.get<{ uploadUrl: string; publicUrl: string }>(
        `/api/v1/posts/upload-url?kind=video&filename=${encodeURIComponent(file.name)}`,
      );
      await putWithProgress(uploadUrl, file, contentType, setUploadPct);
      onChange([...videos, { kind: "file", url: publicUrl, embedUrl: null, title: file.name, thumbnailUrl: null }]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to upload the video. Please try again.");
    } finally {
      setUploadPct(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {SOURCES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSource(id)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
              source === id ? "border-accent bg-accent/10 text-primary" : "border-divider text-muted hover:border-accent/50"
            }`}
          >
            <Icon size={13} className={id === "youtube" ? "text-red-600" : id === "instagram" ? "text-pink-600" : ""} />
            {label}
          </button>
        ))}
      </div>

      {source === "file" ? (
        <>
          <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" onChange={handleFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploadPct !== null || full}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-divider px-4 py-5 text-xs font-semibold text-subtle transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UploadCloud size={16} />
            {uploadPct !== null ? `Uploading… ${uploadPct}%` : `Choose an MP4 or MOV file (max ${MAX_VIDEO_MB} MB)`}
          </button>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center rounded-xl border border-divider bg-background px-3 py-2.5 focus-within:border-accent">
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addLink();
                }
              }}
              placeholder={PLACEHOLDERS[source]}
              disabled={full}
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
            onClick={() => void addLink()}
            disabled={!link.trim() || adding || full}
            aria-label="Add video"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-glow transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #1fc77a, #108b8b)" }}
          >
            {adding ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Plus size={18} />}
          </button>
        </div>
      )}

      {videos.map((v, i) => (
        <div key={v.id ?? v.url} className="flex items-center gap-3 rounded-xl border border-divider bg-background p-2">
          <VideoThumb video={v} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-primary">{v.title ?? (v.kind === "instagram" ? "Instagram post" : "Video")}</p>
            <p className="truncate text-[10px] text-muted">{v.kind === "file" ? "Uploaded video" : v.url}</p>
            <p className="text-[10px] text-subtle">{v.kind === "file" ? "finskool21.in" : hostOf(v.url)}</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(videos.filter((_, j) => j !== i))}
            aria-label="Remove video"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-divider text-muted hover:text-primary"
          >
            <X size={11} />
          </button>
        </div>
      ))}

      <p className="text-xs text-subtle">
        {videos.length}/{MAX_POST_VIDEOS} videos{full ? " — remove one to add another." : "."}
      </p>
    </div>
  );
}

/** Media (images) / Video (uploads, YouTube and Instagram links) tabs for the post editors. */
export default function PostMediaPicker({
  imageUrls,
  onImageUrlsChange,
  videos,
  onVideosChange,
}: {
  imageUrls: string[];
  onImageUrlsChange: (urls: string[]) => void;
  videos: PostVideo[];
  onVideosChange: (videos: PostVideo[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("media");
  const tabs: { id: Tab; label: string; icon: typeof Video; count: number }[] = [
    { id: "media", label: "Media", icon: ImageIcon, count: imageUrls.length },
    { id: "video", label: "Video", icon: Video, count: videos.length },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-5 border-b border-divider" role="tablist">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-semibold transition-colors ${
              tab === id ? "border-accent text-primary" : "border-transparent text-muted hover:text-primary"
            }`}
          >
            <Icon size={14} />
            {label}
            {count > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-[10px] font-bold text-accent">{count}</span>}
          </button>
        ))}
      </div>
      {/* Both stay mounted so a half-finished upload/link isn't lost when switching tabs. */}
      <div hidden={tab !== "media"}>
        <PostImageUploader imageUrls={imageUrls} onChange={onImageUrlsChange} />
      </div>
      <div hidden={tab !== "video"}>
        <VideoEditor videos={videos} onChange={onVideosChange} />
      </div>
    </div>
  );
}
