import { Calendar, Clock, Pin } from "lucide-react";
import type { ReactNode } from "react";
import PostThreads from "./PostThreads";
import { getSession } from "@/lib/session";

type FeedPostCardProps = {
  postId?: string;
  commentCount?: number;
  badge?: { label: string; icon?: "pin" | "idea" };
  communityName?: string;
  authorName?: string;
  timestamp: string;
  title: string;
  body: string;
  bodyHtml?: string;
  imageUrls?: string[];
  tags: string[];
  children?: ReactNode;
  actions?: ReactNode;
};

function formatDateParts(ts: string): { date: string; time: string } {
  // ts is already formatted like "20 Jun 2026 · 9:15 am"
  const parts = ts.split(" · ");
  return { date: parts[0] ?? ts, time: parts[1] ?? "" };
}

export default function FeedPostCard({
  postId,
  commentCount,
  badge,
  communityName,
  authorName,
  timestamp,
  title,
  body,
  bodyHtml,
  imageUrls,
  tags,
  children,
  actions,
}: FeedPostCardProps) {
  const session = typeof window !== "undefined" ? getSession() : null;
  const displayName = authorName ?? session?.userName ?? "Admin";
  const initials = session?.userInitials ?? "A";
  const { date, time } = formatDateParts(timestamp);

  return (
    <div className="rounded-2xl bg-white shadow-card transition-all duration-300 hover:shadow-card-hover">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm font-bold text-white">
              {initials}
            </div>

            {/* Name + badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-semibold text-primary">{displayName}</span>
              {communityName && (
                <span className="flex items-center gap-1 rounded-full border border-accent/50 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
                  ⚡ {communityName}
                </span>
              )}
              {badge && (
                <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/5 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
                  <Pin size={10} />
                  {badge.label}
                </span>
              )}
            </div>
          </div>

          {/* Three-dot actions */}
          {actions && <div className="shrink-0">{actions}</div>}
        </div>

        {/* Title */}
        <h3 className="mt-4 font-display text-base font-bold leading-snug text-primary">
          {title}
        </h3>

        {/* Body */}
        {bodyHtml ? (
          <div
            className="mt-2 text-sm leading-relaxed text-muted [&_p]:my-0.5 [&_strong]:text-primary [&_code]:rounded [&_code]:bg-divider [&_code]:px-1"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : body ? (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{body}</p>
        ) : null}

        {/* Image */}
        {imageUrls && imageUrls.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrls[0]} alt="Post image" className="max-h-72 w-full object-cover" />
          </div>
        )}

        {/* Footer: tags left | date+time right */}
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {tags.map(tag => (
              <span key={tag} className="text-xs font-medium text-muted">
                {tag}
              </span>
            ))}
          </div>
          {timestamp && (
            <div className="flex shrink-0 items-center gap-3 text-xs text-subtle">
              {date && (
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {date}
                </span>
              )}
              {time && (
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {time}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {children}

      {/* Threads */}
      {postId && (
        <div className="px-5 pb-4">
          <PostThreads postId={postId} initialCount={commentCount ?? 0} />
        </div>
      )}
    </div>
  );
}
