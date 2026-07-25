"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

const MAX_IMAGES = 6;

export default function PostImageUploader({
  imageUrls,
  onChange,
}: {
  imageUrls: string[];
  onChange: (urls: string[]) => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;

    const room = MAX_IMAGES - imageUrls.length;
    const toUpload = files.slice(0, room);
    if (files.length > room) {
      toast.error(`You can add up to ${MAX_IMAGES} images per post — only the first ${room} were added.`);
    }
    if (toUpload.length === 0) return;

    setUploading(true);
    try {
      const uploaded = await Promise.all(
        toUpload.map(async (file) => {
          const { uploadUrl, publicUrl } = await api.get<{ uploadUrl: string; publicUrl: string }>(
            `/api/v1/posts/upload-url?filename=${encodeURIComponent(file.name)}`
          );
          await fetch(uploadUrl, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type },
          });
          return publicUrl;
        })
      );
      onChange([...imageUrls, ...uploaded]);
    } catch {
      toast.error("Failed to upload one or more images. Please try again.");
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
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFilesChange}
      />

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {imageUrls.map((url, idx) => (
          <div key={url} className="relative aspect-square overflow-hidden rounded-xl border border-divider">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Post image ${idx + 1}`} className="h-full w-full object-cover" />
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
            disabled={uploading}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-divider text-subtle transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={18} />
            <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Add Image"}</span>
          </button>
        )}
      </div>

      <p className="text-xs text-subtle">Add up to {MAX_IMAGES} images.</p>
    </div>
  );
}
