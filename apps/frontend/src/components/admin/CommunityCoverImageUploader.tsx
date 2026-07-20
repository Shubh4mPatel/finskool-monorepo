"use client";

import { useRef, useState } from "react";
import { Image, X } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

export default function CommunityCoverImageUploader({
  coverImageUrl,
  onChange,
}: {
  coverImageUrl: string | null;
  onChange: (url: string | null) => void;
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
      toast.error("Failed to upload cover image. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFileChange}
      />

      {coverImageUrl ? (
        <div className="relative overflow-hidden rounded-xl border border-divider">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverImageUrl} alt="Cover image" className="max-h-48 w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-primary shadow transition-colors hover:bg-white"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-divider bg-background py-5 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Image size={16} />
          {uploading ? "Uploading…" : "Add Cover Image"}
        </button>
      )}
    </div>
  );
}
