"use client";

import { useRef, useState } from "react";
import { Info, Plus, X } from "lucide-react";
import { ApiError } from "@/lib/api";
import { uploadPostMedia, type UploadedMedia } from "@/lib/post-media";
import { useToast } from "@/components/ui/Toast";
import { MAX_POST_VIDEOS, MAX_VIDEO_MB } from "@/lib/post-videos";

const MAX_IMAGES = 6;

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,.mp4,.mov";

export default function PostImageUploader({
  imageUrls,
  onChange,
  onVideoFile,
  videoUploadPct = null,
  onMeasured,
}: {
  imageUrls: string[];
  onChange: (urls: string[]) => void;
  // Gets the size the server read from each image it just stored.
  onMeasured?: (items: UploadedMedia[]) => void;
  // When given, the picker also accepts videos and hands each one to this callback
  // (which uploads it and adds it to the post's video list) instead of treating it as an image.
  onVideoFile?: (file: File) => Promise<void>;
  videoUploadPct?: number | null;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov)$/i.test(f.name);
    const files = onVideoFile ? picked.filter((f) => !isVideo(f)) : picked;
    if (onVideoFile) {
      for (const video of picked.filter(isVideo)) await onVideoFile(video);
    }
    if (files.length === 0) return;

    const room = MAX_IMAGES - imageUrls.length;
    const toUpload = files.slice(0, room);
    if (files.length > room) {
      toast.error(`You can add up to ${MAX_IMAGES} images per post — only the first ${room} were added.`);
    }
    if (toUpload.length === 0) return;

    setUploading(true);
    try {
      const uploaded = await uploadPostMedia(toUpload);
      onMeasured?.(uploaded);
      onChange([...imageUrls, ...uploaded.map((m) => m.url)]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to upload one or more images. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function removeAt(idx: number) {
    onChange(imageUrls.filter((_, i) => i !== idx));
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={onVideoFile ? `${IMAGE_ACCEPT},${VIDEO_ACCEPT}` : IMAGE_ACCEPT}
        className="hidden"
        onChange={handleFilesChange}
      />

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {imageUrls.map((url, idx) => (
          <div key={url} className="relative aspect-square overflow-hidden rounded-xl border border-divider bg-divider/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Post image ${idx + 1}`} className="h-full w-full object-contain" />
            <button
              type="button"
              onClick={() => removeAt(idx)}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-primary shadow hover:bg-white"
            >
              <X size={12} />
            </button>
          </div>
        ))}

        {imageUrls.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading || videoUploadPct !== null}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-divider text-subtle transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={18} />
            <span className="text-xs font-semibold">
              {videoUploadPct !== null ? `Video ${videoUploadPct}%` : uploading ? "Uploading…" : onVideoFile ? "Add Image / Video" : "Add Image"}
            </span>
          </button>
        )}
      </div>

      <p className="text-xs text-subtle">
        Add up to {MAX_IMAGES} images{onVideoFile ? ` and ${MAX_POST_VIDEOS} videos (MP4 or MOV, max ${MAX_VIDEO_MB} MB each)` : ""}.
      </p>
      <p className="flex items-start gap-1.5 rounded-lg bg-accent/5 px-3 py-2 text-xs text-muted">
        <Info size={13} className="mt-px shrink-0 text-accent" aria-hidden />
        <span>
          <strong className="font-semibold text-primary">Note on ratio:</strong> the first image or video sets the post&apos;s frame
          (between 4:5 and 1.91:1). Files are never cropped on the server. In the app, an image close to the frame&apos;s ratio fills it
          (a thin edge may be trimmed); one that differs a lot is shown whole on a blurred background. Use the same ratio for all files
          (for example 4:5 portrait or 16:9 landscape) and check the preview in the last step. YouTube and Instagram links have no ratio of their own.
        </span>
      </p>
    </div>
  );
}
