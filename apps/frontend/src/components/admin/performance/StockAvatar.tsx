"use client";

import { useState } from "react";
import { TintAvatar } from "@/components/admin/dashboard/TintAvatar";

/**
 * A stock's logo, or its initials when there is no logo on record or the file will not load.
 * Keeps the same footprint either way so the Stock column does not jump between rows.
 */
export function StockAvatar({ name, logoUrl, className = "h-7 w-7" }: { name: string; logoUrl: string | null; className?: string }) {
  // Remember which URL failed, so a row that later gets a new logo is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!logoUrl || failedUrl === logoUrl) return <TintAvatar name={name} className={className} />;
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-divider bg-white ${className}`}>
      <img src={logoUrl} alt="" loading="lazy" onError={() => setFailedUrl(logoUrl)} className="h-full w-full object-contain p-0.5" />
    </span>
  );
}
