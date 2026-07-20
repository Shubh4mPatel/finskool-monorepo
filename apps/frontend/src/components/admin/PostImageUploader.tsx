"use client";

import { useRef, useState } from "react";
import { Image, X } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

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

    setUploading(true);
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => {
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

      {imageUrls.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {imageUrls.map((url, idx) => (
            <div key={url} className="relative overflow-hidden rounded-xl border border-divider">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Post image ${idx + 1}`} className="h-24 w-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-primary shadow hover:bg-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex w-fit items-center gap-2 rounded-xl border border-divider bg-background px-4 py-2 text-sm font-semibold text-muted transition-colors hover:border-accent hover:text-primary disabled:opacity-50"
      >
        <Image size={15} />
        {uploading ? "Uploading…" : imageUrls.length > 0 ? "Add More Images" : "Add Images"}
      </button>
    </div>
  );
}
