"use client";

import { useState } from "react";
import { TintAvatar } from "@/components/admin/dashboard/TintAvatar";
import { Avatar } from "@/components/admin/tickets/TicketBadges";

/**
 * A person's profile picture, or their initials when they have none or the file will not load.
 * Keeps the same footprint either way, so a row does not jump when a picture is missing.
 *
 * `dark` is for an admin's chat bubble: the initials then sit on the dark brand colour, as they did before.
 */
export function UserAvatar({
  name,
  avatarUrl,
  className = "h-9 w-9",
  dark = false,
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
  dark?: boolean;
}) {
  // Remember which URL failed, so a person who later uploads a new picture is tried again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!avatarUrl || failedUrl === avatarUrl) return dark ? <Avatar name={name} dark className={className} /> : <TintAvatar name={name} className={className} />;
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-2 ring-white ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avatarUrl} alt="" loading="lazy" onError={() => setFailedUrl(avatarUrl)} className="h-full w-full object-cover" />
    </span>
  );
}
