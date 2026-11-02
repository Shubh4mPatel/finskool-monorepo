"use client";

import { useRef, useState } from "react";
import { CirclePlus, Image, X } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

export default function CommunityBadgeUploader({
  badgeUrl,
  onChange,
  noun = "Badge",
  large = false,
}: {
  badgeUrl: string | null;
  onChange: (url: string | null) => void;
  /** What the picture is called on screen: "Badge" (the default) or "Icon". */
  noun?: string;
  /** A full-width dashed bar with a circled plus, used on the create page. */
  large?: boolean;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const { uploadUrl, publicUrl } = await api.get<{ uploadUrl: string; publicUrl: string }>(
        `/api/v1/admin/communities/upload-url?filename=${encodeURIComponent(file.name)}`
      );
      await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      onChange(publicUrl);
    } catch {
      toast.error(`Failed to upload ${noun.toLowerCase()}. Please try again.`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml"
        className="hidden"
        onChange={handleFileChange}
      />

      {badgeUrl ? (
        <div className="flex items-center gap-3 rounded-xl border border-divider px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={badgeUrl} alt={`Community ${noun.toLowerCase()}`} className="h-6 w-6" />
          <button
            type="button"
            aria-label={`Remove ${noun.toLowerCase()}`}
            onClick={() => onChange(null)}
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-divider/60 hover:text-primary"
          >
            <X size={13} />
          </button>
        </div>
      ) : large ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-[#d6d9cc] bg-background px-4 py-5 text-base text-primary/70 transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CirclePlus size={18} strokeWidth={1.5} aria-hidden />
          {uploading ? "Uploading…" : `Add ${noun}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-divider bg-background px-4 py-3 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Image size={16} />
          {uploading ? "Uploading…" : `Add ${noun} (SVG)`}
        </button>
      )}
    </div>
  );
}
