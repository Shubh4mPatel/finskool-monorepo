import { Lightbulb, Pin } from "lucide-react";
import type { ReactNode } from "react";
import PriceChart from "./PriceChart";
import PostThreads from "./PostThreads";

type FeedPostCardProps = {
  postId?: string;
  commentCount?: number;
  badge?: { label: string; icon?: "pin" | "idea" };
  communityName?: string;
  timestamp: string;
  title: string;
  body: string;
  bodyHtml?: string;
  imageUrls?: string[];
  tags: string[];
  showChart?: boolean;
  reactions?: number;
  children?: ReactNode;
  actions?: ReactNode;
};

export default function FeedPostCard({
  postId,
  commentCount,
  badge,
  communityName,
  timestamp,
  title,
  body,
  bodyHtml,
  imageUrls,
  tags,
  showChart,
  reactions,
  children,
  actions,
}: FeedPostCardProps) {
  return (
    <div className="group rounded-2xl bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white ring-2 ring-primary/20 ring-offset-2 ring-offset-white">
            A
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display font-semibold text-primary">Admin</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                ADMIN
              </span>
              {communityName && (
                <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-primary">
                  {communityName}
                </span>
              )}
              {badge && (
                <span className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
                  {badge.icon === "pin" && <Pin size={10} />}
                  {badge.icon === "idea" && <Lightbulb size={10} />}
                  {badge.label}
                </span>
              )}
            </div>
            <span className="text-xs text-subtle">{timestamp}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {reactions != null && (
            <span className="rounded-full bg-divider px-3 py-1 text-xs font-semibold text-muted transition-colors group-hover:bg-lime/40 group-hover:text-primary">
              {reactions}
            </span>
          )}
          {actions}
        </div>
      </div>

      <h3 className="mt-4 font-display text-lg font-bold text-primary">{title}</h3>

      {bodyHtml ? (
        <div
          className="mt-2 text-sm leading-relaxed text-muted prose prose-sm max-w-none [&_p]:my-1 [&_strong]:text-primary [&_code]:bg-divider [&_code]:px-1 [&_code]:rounded"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : (
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">{body}</p>
      )}

      {showChart && (
        <div className="mt-4">
          <PriceChart />
        </div>
      )}

      {imageUrls && imageUrls.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-divider">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrls[0]}
            alt="Post image"
            className="max-h-64 w-full object-cover"
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-divider px-3 py-1 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent/5"
          >
            {tag}
          </span>
        ))}
      </div>

      {children}

      {postId && <PostThreads postId={postId} initialCount={commentCount ?? 0} />}
    </div>
  );
}
